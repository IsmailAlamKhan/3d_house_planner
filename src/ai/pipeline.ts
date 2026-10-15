import type { ZodType } from 'zod';
import { briefProblems, completeSite } from './briefCheck';
import { t } from '../i18n';
import type { Project, Selection } from '../model/types';
import { offlineEdit } from './offlineEdit';
import { offlineIntent } from './offline';
import {
  editSystemPrompt,
  editUserPrompt,
  generateSystemPrompt,
  generateUserPrompt,
  repairPrompt,
  type ShellInfo,
} from './prompts';
import {
  type AiSettings,
  type LLMMessage,
  type AiProgress,
  type LLMProvider,
  ProviderError,
  ProviderUnreachable,
  providerFor,
} from './provider';
import {
  DesignIntentSchema,
  EditResponseSchema,
  jsonSchemaOf,
  type DesignIntent,
  type EditOperation,
} from './schemas';
import { summarizeProject } from './summary';

export class AiOutputError extends Error {
  constructor(
    message: string,
    readonly errors: string[],
  ) {
    super(message);
    this.name = 'AiOutputError';
  }
}

/** Removes ``` fences and surrounding chatter, then parses the first JSON object found. */
export function extractJson(text: string): unknown {
  let s = text.trim();
  const fence = /```(?:json)?\s*([\s\S]*?)```/i.exec(s);
  if (fence) s = fence[1]!.trim();
  // Strip any "<think>…</think>" a reasoning model may have left behind.
  s = s.replace(/<think>[\s\S]*?<\/think>/gi, '').trim();
  try {
    return JSON.parse(s);
  } catch {
    const start = s.indexOf('{');
    const end = s.lastIndexOf('}');
    if (start >= 0 && end > start) return JSON.parse(s.slice(start, end + 1));
    throw new SyntaxError('The answer is not JSON.');
  }
}

/** Parses and validates; errors come back as short readable lines (also sent to the model for the repair round). */
export function validate<T>(
  schema: ZodType<T>,
  text: string,
): { ok: true; value: T } | { ok: false; errors: string[] } {
  let raw: unknown;
  try {
    raw = extractJson(text);
  } catch (e) {
    return {
      ok: false,
      errors: [e instanceof Error ? e.message : 'The answer is not valid JSON.'],
    };
  }
  const r = schema.safeParse(raw);
  if (r.success) return { ok: true, value: r.data };
  return {
    ok: false,
    errors: r.error.issues.slice(0, 8).map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`),
  };
}

/**
 * Asks the model, validates, and if needed sends the problems back ONCE before giving up. `check` can flag a valid
 * answer that misses what the brief asked for; if the second answer is no better, the first (valid) one is kept.
 */
async function askValidated<T>(
  provider: LLMProvider,
  messages: LLMMessage[],
  schema: ZodType<T>,
  jsonSchema: Record<string, unknown>,
  signal: AbortSignal | undefined,
  temperature: number,
  check?: (value: T) => string[],
  onProgress?: (p: AiProgress) => void,
): Promise<T> {
  const first = await provider.generate({
    messages,
    schema: jsonSchema,
    temperature,
    signal,
    onProgress,
  });
  const a = validate(schema, first);
  const firstProblems = a.ok ? (check?.(a.value) ?? []) : a.errors;
  if (a.ok && !firstProblems.length) return a.value;

  const second = await provider.generate({
    messages: [
      ...messages,
      { role: 'assistant', content: first.slice(0, 6000) },
      { role: 'user', content: repairPrompt(firstProblems) },
    ],
    schema: jsonSchema,
    temperature: Math.min(temperature, 0.2),
    signal,
    onProgress,
  });
  const b = validate(schema, second);
  if (b.ok) {
    if (!a.ok) return b.value;
    return (check?.(b.value).length ?? 0) <= firstProblems.length ? b.value : a.value;
  }
  if (a.ok) return a.value;
  throw new AiOutputError(t('ai.err.invalid'), b.errors);
}

export type AiSource = 'ollama' | 'openai' | 'offline';

export interface IntentResult {
  intent: DesignIntent;
  source: AiSource;
  /** Lines about what was understood (offline) or why the offline generator stepped in. */
  notes: string[];
  /** Set when the chosen model was not used. */
  fellBack?: 'unreachable' | 'invalid';
}

export interface GenerateOptions {
  settings: AiSettings;
  shell: ShellInfo;
  signal?: AbortSignal;
  /** 0 = first/base design; higher numbers ask for something different (variations). */
  variation?: number;
  /** For tests. */
  provider?: LLMProvider | null;
  onProgress?: (p: AiProgress) => void;
}

const TEMPS = [0.2, 0.7, 0.9];

/** Brief → DesignIntent through the chosen model, with one repair round and an automatic offline fallback. */
export async function generateIntent(brief: string, opts: GenerateOptions): Promise<IntentResult> {
  const provider = opts.provider !== undefined ? opts.provider : providerFor(opts.settings);
  const variation = opts.variation ?? 0;
  const offline = (fellBack?: IntentResult['fellBack'], extra?: string): IntentResult => {
    const r = offlineIntent(brief, variation, { villa: opts.shell.villa });
    const notes = [...(extra ? [extra] : []), ...(fellBack ? [] : [])];
    return { intent: r.intent, source: 'offline', notes: [...notes, ...r.understood], fellBack };
  };
  if (!provider) return offline();
  const messages: LLMMessage[] = [
    { role: 'system', content: generateSystemPrompt(opts.shell) },
    {
      role: 'user',
      content: generateUserPrompt(
        variation > 0
          ? `${brief}\n(Make this variation clearly different from a standard layout — vary room sizes and which rooms go on which floor.)`
          : brief,
      ),
    },
  ];
  try {
    const intent = await askValidated(
      provider,
      messages,
      DesignIntentSchema as unknown as ZodType<DesignIntent>,
      jsonSchemaOf(DesignIntentSchema),
      opts.signal,
      TEMPS[Math.min(variation, TEMPS.length - 1)]!,
      (i) => briefProblems(brief, i),
      opts.onProgress,
    );
    // A villa keeps the outdoor features the brief names, even if the model left them out.
    const completed = opts.shell.villa
      ? completeSite(intent, offlineIntent(brief, 0, { villa: true }).intent)
      : intent;
    return { intent: completed, source: provider.id, notes: [] };
  } catch (e) {
    if (opts.signal?.aborted) throw e;
    if (e instanceof ProviderUnreachable)
      return offline('unreachable', t('ai.fallback.unreachable'));
    if (e instanceof AiOutputError) return offline('invalid', t('ai.fallback.invalid'));
    if (e instanceof ProviderError) return offline('unreachable', e.message);
    throw e;
  }
}

export interface EditResult {
  operations: EditOperation[];
  summary?: string;
  source: AiSource;
  notes: string[];
  fellBack?: 'unreachable' | 'invalid';
}

export interface EditOptions {
  settings: AiSettings;
  project: Project;
  selection: Selection;
  activeLevelId: string;
  signal?: AbortSignal;
  provider?: LLMProvider | null;
  onProgress?: (p: AiProgress) => void;
}

/** Command → EditOperations. Without a reachable model a small rule-based reader handles the common commands. */
export async function interpretEdit(command: string, opts: EditOptions): Promise<EditResult> {
  const provider = opts.provider !== undefined ? opts.provider : providerFor(opts.settings);
  const viaRules = (fellBack?: EditResult['fellBack'], note?: string): EditResult => {
    const ops = offlineEdit(command, opts.project);
    if (!ops)
      throw new AiOutputError(
        fellBack ? t('ai.err.editNeedsModel') : t('ai.err.editNotUnderstood'),
        [],
      );
    return { operations: ops, source: 'offline', notes: note ? [note] : [], fellBack };
  };
  if (!provider) return viaRules();
  const messages: LLMMessage[] = [
    { role: 'system', content: editSystemPrompt() },
    {
      role: 'user',
      content: editUserPrompt(
        summarizeProject(opts.project, opts.selection, opts.activeLevelId),
        command,
      ),
    },
  ];
  try {
    const r = await askValidated(
      provider,
      messages,
      EditResponseSchema as unknown as ZodType<{ summary?: string; operations: EditOperation[] }>,
      jsonSchemaOf(EditResponseSchema),
      opts.signal,
      0.2,
      undefined,
      opts.onProgress,
    );
    return { operations: r.operations, summary: r.summary, source: provider.id, notes: [] };
  } catch (e) {
    if (opts.signal?.aborted) throw e;
    if (e instanceof ProviderUnreachable)
      return viaRules('unreachable', t('ai.fallback.unreachableEdit'));
    if (e instanceof AiOutputError) return viaRules('invalid', t('ai.fallback.invalidEdit'));
    if (e instanceof ProviderError) return viaRules('unreachable', e.message);
    throw e;
  }
}
