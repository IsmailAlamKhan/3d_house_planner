import type { IncomingMessage, ServerResponse } from 'node:http';

/**
 * Same-origin proxy for local language models, so the browser never talks to Ollama / LM Studio directly.
 * Used by the Vite dev & preview servers now and by the production server later.
 *
 *   POST /api/ai   { target: 'ollama' | 'openai', baseUrl?, path, method?, body? }
 *
 * Only a short allow-list of paths is forwarded; requests are size- and time-limited and generation requests are
 * queued one at a time so a small GPU is never overloaded.
 */
export interface AiProxyOptions {
  /** Where Ollama listens (default http://127.0.0.1:11434, or $OLLAMA_URL). */
  ollamaUrl?: string;
  /** Request body limit in bytes (default 1 MB). */
  maxBody?: number;
  /** Upstream timeout in ms (default 180 s). */
  timeoutMs?: number;
  /** Allow `openai` targets on any host (default: loopback and private-network hosts only). */
  allowAnyHost?: boolean;
}

export const OLLAMA_PATHS = ['/api/chat', '/api/tags'] as const;
export const OPENAI_PATHS = ['/chat/completions', '/models'] as const;

interface Envelope {
  target: 'ollama' | 'openai';
  baseUrl?: string;
  path: string;
  method?: 'GET' | 'POST';
  body?: unknown;
  /** Ollama chat only: answer as newline-delimited JSON events (queue position, progress, final data). */
  stream?: boolean;
}

const PRIVATE_HOST =
  /^(localhost|127\.\d+\.\d+\.\d+|\[?::1\]?|10\.\d+\.\d+\.\d+|192\.168\.\d+\.\d+|172\.(1[6-9]|2\d|3[01])\.\d+\.\d+|[\w-]+\.local|host\.docker\.internal)$/i;

/** Whether `url` points at this machine or the home network (an SSRF guard for the OpenAI-compatible target). */
export function isPrivateUrl(url: string): boolean {
  try {
    const u = new URL(url);
    return (u.protocol === 'http:' || u.protocol === 'https:') && PRIVATE_HOST.test(u.hostname);
  } catch {
    return false;
  }
}

function send(res: ServerResponse, status: number, body: unknown): void {
  const text = typeof body === 'string' ? body : JSON.stringify(body);
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json');
  res.end(text);
}

function readBody(req: IncomingMessage, max: number): Promise<string> {
  return new Promise((resolve, reject) => {
    let size = 0;
    let tooBig = false;
    const chunks: Buffer[] = [];
    req.on('data', (c: Buffer) => {
      size += c.length;
      // Keep draining so the client can read our 413, but never buffer more than the limit.
      if (size > max) tooBig = true;
      else chunks.push(c);
    });
    req.on('end', () =>
      tooBig
        ? reject(Object.assign(new Error('Request too large'), { status: 413 }))
        : resolve(Buffer.concat(chunks).toString('utf8')),
    );
    req.on('error', reject);
  });
}

export function createAiProxy(options: AiProxyOptions = {}) {
  const ollamaUrl = (
    options.ollamaUrl ??
    process.env.OLLAMA_URL ??
    'http://127.0.0.1:11434'
  ).replace(/\/+$/, '');
  const maxBody = options.maxBody ?? 1024 * 1024;
  const timeoutMs = options.timeoutMs ?? 180_000;
  // One generation at a time (queued FIFO); cheap listing calls skip the queue.
  let tail: Promise<unknown> = Promise.resolve();
  /** Jobs running or waiting (so a newcomer knows how many are ahead of it). */
  let pending = 0;
  const enqueue = <T>(job: () => Promise<T>): Promise<T> => {
    pending++;
    const run = tail.then(job, job);
    tail = run.catch(() => undefined).finally(() => void pending--);
    return run;
  };

  return async function handler(req: IncomingMessage, res: ServerResponse): Promise<void> {
    if (req.method !== 'POST') return send(res, 405, { error: 'Use POST /api/ai' });
    let env: Envelope;
    try {
      env = JSON.parse(await readBody(req, maxBody)) as Envelope;
    } catch (e) {
      const status = (e as { status?: number }).status ?? 400;
      return send(res, status, { error: status === 413 ? 'Request too large' : 'Invalid JSON' });
    }

    let base: string;
    let allowed: readonly string[];
    if (env.target === 'ollama') {
      base = ollamaUrl;
      allowed = OLLAMA_PATHS;
    } else if (env.target === 'openai') {
      base = (env.baseUrl ?? '').replace(/\/+$/, '');
      allowed = OPENAI_PATHS;
      if (!base || (!options.allowAnyHost && !isPrivateUrl(base))) {
        return send(res, 400, {
          error: 'The OpenAI-compatible server must be on this machine or your home network.',
        });
      }
    } else {
      return send(res, 400, { error: 'Unknown target' });
    }
    if (!allowed.includes(env.path)) return send(res, 403, { error: 'That path is not allowed' });
    const method = env.method === 'GET' ? 'GET' : 'POST';

    const call = async () => {
      const ctl = new AbortController();
      const timer = setTimeout(() => ctl.abort(), timeoutMs);
      const onClose = () => ctl.abort();
      res.on('close', onClose);
      try {
        const upstream = await fetch(base + env.path, {
          method,
          headers: { 'Content-Type': 'application/json' },
          body: method === 'POST' ? JSON.stringify(env.body ?? {}) : undefined,
          signal: ctl.signal,
        });
        const text = await upstream.text();
        if (!res.writableEnded) send(res, upstream.status, text || '{}');
      } catch (e) {
        if (res.writableEnded) return;
        const aborted = (e as { name?: string }).name === 'AbortError';
        send(res, aborted ? 504 : 502, {
          error: aborted
            ? 'The model took too long to answer.'
            : 'Could not reach the language model.',
          code: aborted ? 'timeout' : 'unreachable',
        });
      } finally {
        clearTimeout(timer);
        res.off('close', onClose);
      }
    };
    // Streaming (Ollama chat): tell the browser where it is in the queue, then relay the model's tokens as they come.
    if (env.stream && env.target === 'ollama' && env.path === '/api/chat') {
      res.statusCode = 200;
      res.setHeader('Content-Type', 'application/x-ndjson');
      res.setHeader('Cache-Control', 'no-store');
      const line = (o: unknown) => !res.writableEnded && res.write(JSON.stringify(o) + '\n');
      if (pending > 0) line({ type: 'queued', ahead: pending });
      const callStream = async () => {
        const ctl = new AbortController();
        const timer = setTimeout(() => ctl.abort(), timeoutMs);
        const onClose = () => ctl.abort();
        res.on('close', onClose);
        try {
          line({ type: 'start' });
          const upstream = await fetch(base + env.path, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ ...(env.body as object), stream: true }),
            signal: ctl.signal,
          });
          if (!upstream.ok || !upstream.body) {
            const text = await upstream.text().catch(() => '');
            let error = `AI server error ${upstream.status}`;
            try {
              error = (JSON.parse(text) as { error?: string }).error ?? error;
            } catch {
              // keep the generic message
            }
            line({ type: 'error', status: upstream.status, error });
            return;
          }
          const reader = upstream.body.getReader();
          const decoder = new TextDecoder();
          let buffer = '';
          for (;;) {
            const { done, value } = await reader.read();
            if (done) break;
            buffer += decoder.decode(value, { stream: true });
            let nl: number;
            while ((nl = buffer.indexOf('\n')) >= 0) {
              const raw = buffer.slice(0, nl).trim();
              buffer = buffer.slice(nl + 1);
              if (!raw) continue;
              try {
                line({ type: 'data', payload: JSON.parse(raw) });
              } catch {
                // a partial or odd line from the model server is skipped
              }
            }
          }
          line({ type: 'end' });
        } catch (e) {
          const aborted = (e as { name?: string }).name === 'AbortError';
          line({
            type: 'error',
            status: aborted ? 504 : 502,
            error: aborted
              ? 'The model took too long to answer.'
              : 'Could not reach the language model.',
          });
        } finally {
          clearTimeout(timer);
          res.off('close', onClose);
          if (!res.writableEnded) res.end();
        }
      };
      await enqueue(callStream);
      return;
    }
    await (env.path === '/api/chat' || env.path === '/chat/completions' ? enqueue(call) : call());
  };
}
