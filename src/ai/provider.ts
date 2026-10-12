import { create } from 'zustand';

export interface LLMMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface LLMRequest {
  messages: LLMMessage[];
  /** JSON Schema the answer must follow (sent as Ollama `format` / OpenAI `response_format`). */
  schema?: Record<string, unknown>;
  temperature?: number;
  signal?: AbortSignal;
  /** Live status of a generation: waiting in the server's queue, or the model is writing (character count so far). */
  onProgress?: (p: AiProgress) => void;
}

export type AiProgress = { phase: 'queued'; ahead: number } | { phase: 'thinking'; chars: number };

export interface LLMProvider {
  readonly id: 'ollama' | 'openai';
  /** Returns the raw text of the model's answer. */
  generate(req: LLMRequest): Promise<string>;
}

/** The model cannot be reached (not running, wrong address, timed out). The caller falls back to the offline generator. */
export class ProviderUnreachable extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ProviderUnreachable';
  }
}

/** The model answered but not with something usable (e.g. the model is not installed). */
export class ProviderError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ProviderError';
  }
}

export type ProviderChoice = 'ollama' | 'openai' | 'offline';

export interface AiSettings {
  provider: ProviderChoice;
  /** Ollama model name. */
  model: string;
  /** OpenAI-compatible server (LM Studio, llama.cpp …). */
  openaiBaseUrl: string;
  openaiModel: string;
  /** Give up after this many seconds. */
  timeoutSec: number;
}

export const DEFAULT_MODEL = 'qwen3:14b';

const defaults: AiSettings = {
  provider: 'ollama',
  model: DEFAULT_MODEL,
  openaiBaseUrl: 'http://127.0.0.1:1234/v1',
  openaiModel: '',
  timeoutSec: 180,
};

const KEY = 'duplex-designer:ai-settings';

function load(): AiSettings {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? { ...defaults, ...(JSON.parse(raw) as Partial<AiSettings>) } : defaults;
  } catch {
    return defaults;
  }
}

export type ConnectionStatus = 'unknown' | 'checking' | 'ok' | 'unreachable' | 'no-model';

interface AiSettingsState extends AiSettings {
  status: ConnectionStatus;
  models: string[];
  statusMessage: string;
  set: (patch: Partial<AiSettings>) => void;
  setStatus: (status: ConnectionStatus, models?: string[], message?: string) => void;
}

export const useAiSettings = create<AiSettingsState>((set, get) => ({
  ...load(),
  status: 'unknown',
  models: [],
  statusMessage: '',
  set: (patch) => {
    set(patch);
    const { provider, model, openaiBaseUrl, openaiModel, timeoutSec } = get();
    try {
      localStorage.setItem(
        KEY,
        JSON.stringify({ provider, model, openaiBaseUrl, openaiModel, timeoutSec }),
      );
    } catch {
      // Settings are a convenience only.
    }
  },
  setStatus: (status, models = [], statusMessage = '') => set({ status, models, statusMessage }),
}));

export const currentSettings = (): AiSettings => {
  const { provider, model, openaiBaseUrl, openaiModel, timeoutSec } = useAiSettings.getState();
  return { provider, model, openaiBaseUrl, openaiModel, timeoutSec };
};

// ───────────────────────── HTTP through the app's own /api/ai endpoint ─────────────────────────

interface Envelope {
  target: 'ollama' | 'openai';
  baseUrl?: string;
  path: string;
  method?: 'GET' | 'POST';
  body?: unknown;
}

/** Posts an envelope to the app server's `/api/ai` proxy (the browser never calls Ollama itself). */
export async function callProxy(
  env: Envelope,
  signal?: AbortSignal,
  timeoutSec = 180,
): Promise<unknown> {
  const timeout = AbortSignal.timeout(timeoutSec * 1000 + 5000);
  const combined = signal ? AbortSignal.any([signal, timeout]) : timeout;
  let res: Response;
  try {
    res = await fetch('/api/ai', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(env),
      signal: combined,
    });
  } catch (e) {
    if (signal?.aborted) throw e; // user cancelled
    throw new ProviderUnreachable(e instanceof Error ? e.message : 'Network error');
  }
  const text = await res.text();
  let json: unknown;
  try {
    json = text ? JSON.parse(text) : {};
  } catch {
    // Proxy missing (e.g. a static host answered with HTML): treat as "no AI server here".
    throw new ProviderUnreachable('The AI endpoint is not available on this server.');
  }
  if (res.status === 502 || res.status === 504 || res.status === 404 || res.status === 405) {
    throw new ProviderUnreachable(
      (json as { error?: string }).error ?? `AI server error ${res.status}`,
    );
  }
  if (!res.ok)
    throw new ProviderError((json as { error?: string }).error ?? `AI server error ${res.status}`);
  return json;
}

/**
 * Like `callProxy`, but asks the server to stream: it reports the queue position and the model's progress, and
 * returns the same JSON shape a non-streaming Ollama chat answer has. Only the final, assembled answer is returned.
 */
export async function callProxyStream(
  env: Envelope,
  onProgress: (p: AiProgress) => void,
  signal?: AbortSignal,
  timeoutSec = 180,
): Promise<{ message: { content: string } }> {
  const timeout = AbortSignal.timeout(timeoutSec * 1000 + 5000);
  const combined = signal ? AbortSignal.any([signal, timeout]) : timeout;
  let res: Response;
  try {
    res = await fetch('/api/ai', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...env, stream: true }),
      signal: combined,
    });
  } catch (e) {
    if (signal?.aborted) throw e;
    throw new ProviderUnreachable(e instanceof Error ? e.message : 'Network error');
  }
  const type = res.headers.get('Content-Type') ?? '';
  if (!type.includes('x-ndjson') || !res.body) {
    // An older or different server: it answered in one piece (or not at all).
    const text = await res.text();
    try {
      const json = JSON.parse(text) as { message?: { content?: string }; error?: string };
      if ([502, 504, 404, 405].includes(res.status))
        throw new ProviderUnreachable(json.error ?? `AI server error ${res.status}`);
      if (json.error) throw new ProviderError(json.error);
      return { message: { content: json.message?.content ?? '' } };
    } catch (e) {
      if (e instanceof ProviderError || e instanceof ProviderUnreachable) throw e;
      throw new ProviderUnreachable('The AI endpoint is not available on this server.');
    }
  }
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let content = '';
  const handle = (raw: string) => {
    const ev = JSON.parse(raw) as {
      type: string;
      ahead?: number;
      status?: number;
      error?: string;
      payload?: { message?: { content?: string }; error?: string };
    };
    if (ev.type === 'queued') onProgress({ phase: 'queued', ahead: ev.ahead ?? 1 });
    else if (ev.type === 'start') onProgress({ phase: 'thinking', chars: 0 });
    else if (ev.type === 'data') {
      if (ev.payload?.error) throw new ProviderError(ev.payload.error);
      content += ev.payload?.message?.content ?? '';
      onProgress({ phase: 'thinking', chars: content.length });
    } else if (ev.type === 'error') {
      if (ev.status === 502 || ev.status === 504 || ev.status === 404)
        throw new ProviderUnreachable(ev.error ?? `AI server error ${ev.status}`);
      throw new ProviderError(ev.error ?? 'The model could not answer.');
    }
  };
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let nl: number;
      while ((nl = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, nl).trim();
        buffer = buffer.slice(nl + 1);
        if (line) handle(line);
      }
    }
    if (buffer.trim()) handle(buffer.trim());
  } catch (e) {
    if (signal?.aborted) throw e;
    if (e instanceof ProviderError || e instanceof ProviderUnreachable) throw e;
    throw new ProviderUnreachable(
      e instanceof Error ? e.message : 'The connection was interrupted.',
    );
  }
  return { message: { content } };
}

export function createOllamaProvider(s: AiSettings): LLMProvider {
  const missing = (message: string) =>
    new ProviderError(
      /not found/i.test(message)
        ? `The model "${s.model}" is not installed. Run: ollama pull ${s.model}`
        : message,
    );
  return {
    id: 'ollama',
    async generate(req) {
      let json: { message?: { content?: string }; error?: string };
      try {
        const env = {
          target: 'ollama' as const,
          path: '/api/chat',
          body: {
            model: s.model,
            messages: req.messages,
            stream: false,
            think: false,
            ...(req.schema ? { format: req.schema } : {}),
            options: { temperature: req.temperature ?? 0.2, num_ctx: 8192 },
          },
        };
        json = req.onProgress
          ? await callProxyStream(env, req.onProgress, req.signal, s.timeoutSec)
          : ((await callProxy(env, req.signal, s.timeoutSec)) as typeof json);
      } catch (e) {
        if (e instanceof ProviderError) throw missing(e.message);
        throw e;
      }
      if (json.error) throw missing(json.error);
      const content = json.message?.content;
      if (typeof content !== 'string') throw new ProviderError('The model sent an empty answer.');
      return content;
    },
  };
}

export function createOpenAiProvider(s: AiSettings): LLMProvider {
  return {
    id: 'openai',
    async generate(req) {
      const json = (await callProxy(
        {
          target: 'openai',
          baseUrl: s.openaiBaseUrl,
          path: '/chat/completions',
          body: {
            model: s.openaiModel || undefined,
            messages: req.messages,
            temperature: req.temperature ?? 0.2,
            stream: false,
            ...(req.schema
              ? {
                  response_format: {
                    type: 'json_schema',
                    json_schema: { name: 'result', schema: req.schema },
                  },
                }
              : {}),
          },
        },
        req.signal,
        s.timeoutSec,
      )) as {
        choices?: { message?: { content?: string } }[];
        error?: { message?: string } | string;
      };
      const err = typeof json.error === 'string' ? json.error : json.error?.message;
      if (err) throw new ProviderError(err);
      const content = json.choices?.[0]?.message?.content;
      if (typeof content !== 'string') throw new ProviderError('The model sent an empty answer.');
      return content;
    },
  };
}

/** The provider chosen in settings, or null when the offline generator is selected. */
export function providerFor(s: AiSettings): LLMProvider | null {
  if (s.provider === 'ollama') return createOllamaProvider(s);
  if (s.provider === 'openai') return createOpenAiProvider(s);
  return null;
}

export interface ConnectionTest {
  ok: boolean;
  models: string[];
  message: string;
}

/** "Test connection": lists the models the chosen server has installed. */
export async function testConnection(s: AiSettings, signal?: AbortSignal): Promise<ConnectionTest> {
  try {
    if (s.provider === 'ollama') {
      const json = (await callProxy(
        { target: 'ollama', path: '/api/tags', method: 'GET' },
        signal,
        10,
      )) as { models?: { name: string }[] };
      const models = (json.models ?? []).map((m) => m.name);
      const has = models.some(
        (m) => m === s.model || m.startsWith(`${s.model}:`) || s.model.startsWith(`${m}:`),
      );
      return {
        ok: true,
        models,
        message: has ? 'ok' : models.length ? `missing:${s.model}` : 'empty',
      };
    }
    if (s.provider === 'openai') {
      const json = (await callProxy(
        { target: 'openai', baseUrl: s.openaiBaseUrl, path: '/models', method: 'GET' },
        signal,
        10,
      )) as { data?: { id: string }[] };
      return { ok: true, models: (json.data ?? []).map((m) => m.id), message: 'ok' };
    }
    return { ok: true, models: [], message: 'offline' };
  } catch (e) {
    if (signal?.aborted) throw e;
    return { ok: false, models: [], message: e instanceof Error ? e.message : 'unreachable' };
  }
}
