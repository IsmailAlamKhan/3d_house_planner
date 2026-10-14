import type { IncomingMessage, ServerResponse } from 'node:http';
import type { GpuQueue } from '../gpuQueue';

/**
 * `POST /api/vision` — "read this picture" for the local vision model (Ollama, e.g. qwen3-vl:8b).
 *
 *   { prompt, system?, images: [base64 | data URL] (1–4, PNG/JPEG/WebP), schema?, temperature? } → { content }
 *
 * The call goes through the one GPU queue, so the vision model, the language model and ComfyUI never share the card
 * (the queue unloads the other model when the two take turns). Only this one model, set by `OLLAMA_VISION_MODEL`, can
 * be asked; sizes and time are limited.
 */
export interface VisionOptions {
  ollamaUrl: string;
  model: string;
  queue: GpuQueue;
  /** Request body limit in bytes (default 24 MB). */
  maxBody?: number;
  /** Upstream timeout in ms (default 5 min: the first call also loads the model). */
  timeoutMs?: number;
}

const MAX_IMAGES = 4;
const MAX_IMAGE_BYTES = 8 * 1024 * 1024;

const send = (res: ServerResponse, status: number, body: unknown) => {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json');
  res.end(JSON.stringify(body));
};

function readBody(req: IncomingMessage, max: number): Promise<string> {
  return new Promise((resolve, reject) => {
    let size = 0;
    let tooBig = false;
    const chunks: Buffer[] = [];
    req.on('data', (c: Buffer) => {
      size += c.length;
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

/** Raw base64 of an image given as base64 or a data URL; null when it is not an image of a sane size. */
export function cleanImage(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const b64 = value.replace(/^data:image\/(png|jpe?g|webp);base64,/, '').replace(/\s+/g, '');
  if (!/^[A-Za-z0-9+/]+=*$/.test(b64)) return null;
  const bytes = Math.floor((b64.length * 3) / 4);
  if (bytes < 32 || bytes > MAX_IMAGE_BYTES) return null;
  return b64;
}

export function createVisionService(opts: VisionOptions) {
  const maxBody = opts.maxBody ?? 24 * 1024 * 1024;
  const timeoutMs = opts.timeoutMs ?? 300_000;

  return {
    model: opts.model,
    async handle(req: IncomingMessage, res: ServerResponse, path: string): Promise<boolean> {
      if (path !== '/api/vision') return false;
      if (req.method !== 'POST') {
        send(res, 405, { error: 'Use POST /api/vision' });
        return true;
      }
      let body: {
        prompt?: unknown;
        system?: unknown;
        images?: unknown;
        schema?: unknown;
        temperature?: unknown;
      };
      try {
        body = JSON.parse(await readBody(req, maxBody)) as typeof body;
      } catch (e) {
        const status = (e as { status?: number }).status ?? 400;
        send(res, status, { error: status === 413 ? 'Request too large' : 'Invalid JSON' });
        return true;
      }
      const images = Array.isArray(body.images) ? body.images.map(cleanImage) : [];
      if (
        typeof body.prompt !== 'string' ||
        !body.prompt.trim() ||
        body.prompt.length > 20_000 ||
        images.length < 1 ||
        images.length > MAX_IMAGES ||
        images.some((i) => i === null)
      ) {
        send(res, 400, { error: `Send a prompt and 1–${MAX_IMAGES} PNG, JPEG or WebP images.` });
        return true;
      }
      const messages = [
        ...(typeof body.system === 'string' && body.system
          ? [{ role: 'system', content: body.system.slice(0, 20_000) }]
          : []),
        { role: 'user', content: body.prompt, images },
      ];
      const schema =
        body.schema && typeof body.schema === 'object' ? (body.schema as object) : undefined;
      const temperature = typeof body.temperature === 'number' ? body.temperature : 0;
      let aborted = false;
      res.on('close', () => (aborted = true));

      await opts.queue
        .run('vision', async () => {
          if (aborted) return;
          const ctl = new AbortController();
          const timer = setTimeout(() => ctl.abort(), timeoutMs);
          try {
            const r = await fetch(`${opts.ollamaUrl}/api/chat`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                model: opts.model,
                messages,
                stream: false,
                think: false,
                ...(schema ? { format: schema } : {}),
                options: { temperature, num_ctx: 8192 },
              }),
              signal: ctl.signal,
            });
            const text = await r.text();
            let j: { message?: { content?: string }; error?: string } = {};
            try {
              j = JSON.parse(text) as typeof j;
            } catch {
              // not JSON: reported below
            }
            if (!r.ok || j.error) {
              const missing = /not found/i.test(j.error ?? '');
              send(res, missing ? 404 : 502, {
                error: missing
                  ? `The picture-reading model "${opts.model}" is not installed. Run: ollama pull ${opts.model}`
                  : (j.error ?? `The model server answered ${r.status}.`),
                code: missing ? 'no-model' : 'upstream',
              });
              return;
            }
            send(res, 200, { content: j.message?.content ?? '', model: opts.model });
          } catch (e) {
            const timedOut = (e as { name?: string }).name === 'AbortError';
            send(res, timedOut ? 504 : 502, {
              error: timedOut
                ? 'The picture-reading model took too long.'
                : 'Could not reach the language model server.',
              code: timedOut ? 'timeout' : 'unreachable',
            });
          } finally {
            clearTimeout(timer);
          }
        })
        .catch(() => undefined);
      return true;
    },
  };
}
