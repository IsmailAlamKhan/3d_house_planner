import { ProviderError, ProviderUnreachable } from '../provider';

/** What the pipeline needs from "something that can read a picture": the browser talks to `/api/vision`, tests and the eval script talk to a fake or straight to Ollama. */
export interface VisionRequest {
  prompt: string;
  system?: string;
  /** PNG / JPEG as base64 (a data URL is accepted too). */
  images: string[];
  /** JSON Schema the answer must follow. */
  schema?: Record<string, unknown>;
  temperature?: number;
  signal?: AbortSignal;
}
export interface VisionClient {
  /** The model's raw text answer (JSON when a schema was given). */
  ask(req: VisionRequest): Promise<string>;
}

/** Calls the app server's `/api/vision` (the one GPU queue; the browser never talks to Ollama). */
export function browserVisionClient(timeoutSec = 300): VisionClient {
  return {
    async ask(req) {
      const timeout = AbortSignal.timeout(timeoutSec * 1000);
      const signal = req.signal ? AbortSignal.any([req.signal, timeout]) : timeout;
      let res: Response;
      try {
        res = await fetch('/api/vision', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            prompt: req.prompt,
            system: req.system,
            images: req.images,
            schema: req.schema,
            temperature: req.temperature ?? 0,
          }),
          signal,
        });
      } catch (e) {
        if (req.signal?.aborted) throw e;
        throw new ProviderUnreachable(e instanceof Error ? e.message : 'Network error');
      }
      let json: { content?: string; error?: string; code?: string } = {};
      try {
        json = (await res.json()) as typeof json;
      } catch {
        throw new ProviderUnreachable(
          'The picture-reading service is not available on this server.',
        );
      }
      if (res.status === 502 || res.status === 504 || res.status === 405)
        throw new ProviderUnreachable(json.error ?? `Picture reading failed (${res.status})`);
      if (!res.ok) throw new ProviderError(json.error ?? `Picture reading failed (${res.status})`);
      return json.content ?? '';
    },
  };
}

/** The first JSON object in a model's answer (it may wrap it in a code fence or add a sentence). */
export function jsonOf(text: string): unknown {
  const t = text
    .trim()
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/```\s*$/, '');
  const a = t.indexOf('{');
  const b = t.lastIndexOf('}');
  if (a < 0 || b <= a) throw new ProviderError('The model did not answer with JSON.');
  try {
    return JSON.parse(t.slice(a, b + 1));
  } catch {
    throw new ProviderError('The model sent JSON that could not be read.');
  }
}
