import type { IncomingMessage, ServerResponse } from 'node:http';
import type { GpuQueue } from '../gpuQueue';

/**
 * `POST /api/voice/transcribe` — speech to text with a local whisper.cpp server (no cloud speech service).
 *
 *   body: a 16 kHz mono WAV (`Content-Type: audio/wav`); query `?language=en|bn|auto` → `{ text, language }`
 *
 * Runs through the one GPU queue like the language and vision models. `GET /api/voice/health` says whether the
 * service is configured and reachable (the page hides the microphone button when it is not).
 */
export interface VoiceOptions {
  whisperUrl: string | null;
  queue: GpuQueue;
  /** Audio size limit in bytes (default 20 MB ≈ 10 minutes of 16 kHz mono WAV). */
  maxBytes?: number;
  timeoutMs?: number;
}

const send = (res: ServerResponse, status: number, body: unknown) => {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json');
  res.end(JSON.stringify(body));
};

function readAll(req: IncomingMessage, max: number): Promise<Buffer> {
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
        ? reject(Object.assign(new Error('Audio too large'), { status: 413 }))
        : resolve(Buffer.concat(chunks)),
    );
    req.on('error', reject);
  });
}

/** A 16 kHz mono 16-bit PCM WAV: "RIFF" header, "WAVE", format chunk 1 (PCM), data chunk. */
export function looksLikeWav(b: Buffer): boolean {
  return (
    b.length > 44 && b.toString('ascii', 0, 4) === 'RIFF' && b.toString('ascii', 8, 12) === 'WAVE'
  );
}

export function createVoiceService(opts: VoiceOptions) {
  const maxBytes = opts.maxBytes ?? 20 * 1024 * 1024;
  const timeoutMs = opts.timeoutMs ?? 120_000;
  let cached: { at: number; reachable: boolean } | null = null;

  async function health(): Promise<{ configured: boolean; reachable: boolean }> {
    if (!opts.whisperUrl) return { configured: false, reachable: false };
    if (cached && Date.now() - cached.at < 30_000)
      return { configured: true, reachable: cached.reachable };
    const reachable = await fetch(opts.whisperUrl, { signal: AbortSignal.timeout(1500) }).then(
      (r) => r.status < 500,
      () => false,
    );
    cached = { at: Date.now(), reachable };
    return { configured: true, reachable };
  }

  return {
    health,
    async handle(
      req: IncomingMessage,
      res: ServerResponse,
      path: string,
      query: URLSearchParams,
    ): Promise<boolean> {
      if (path === '/api/voice/health') {
        send(res, 200, await health());
        return true;
      }
      if (path !== '/api/voice/transcribe') return false;
      if (req.method !== 'POST') {
        send(res, 405, { error: 'Use POST /api/voice/transcribe' });
        return true;
      }
      if (!opts.whisperUrl) {
        send(res, 404, {
          error: 'Voice input is not set up on this server (start the "voice" profile).',
          code: 'no-voice',
        });
        return true;
      }
      let audio: Buffer;
      try {
        audio = await readAll(req, maxBytes);
      } catch (e) {
        const status = (e as { status?: number }).status ?? 400;
        send(res, status, {
          error: status === 413 ? 'The recording is too long.' : 'Could not read the recording.',
        });
        return true;
      }
      if (!looksLikeWav(audio)) {
        send(res, 400, { error: 'Send a 16 kHz mono WAV recording.' });
        return true;
      }
      const language = ['en', 'bn', 'auto'].includes(query.get('language') ?? '')
        ? query.get('language')!
        : 'auto';
      let aborted = false;
      res.on('close', () => (aborted = true));
      await opts.queue
        .run('vision', async () => {
          if (aborted) return;
          const ctl = new AbortController();
          const timer = setTimeout(() => ctl.abort(), timeoutMs);
          try {
            const form = new FormData();
            form.append(
              'file',
              new Blob([new Uint8Array(audio)], { type: 'audio/wav' }),
              'speech.wav',
            );
            form.append('response_format', 'json');
            form.append('language', language);
            form.append('temperature', '0');
            const r = await fetch(`${opts.whisperUrl}/inference`, {
              method: 'POST',
              body: form,
              signal: ctl.signal,
            });
            const text = await r.text();
            let j: { text?: string; language?: string; error?: string } = {};
            try {
              j = JSON.parse(text) as typeof j;
            } catch {
              // reported below
            }
            if (!r.ok || j.error) {
              send(res, 502, {
                error: j.error ?? `The speech service answered ${r.status}.`,
                code: 'upstream',
              });
              return;
            }
            send(res, 200, { text: (j.text ?? '').trim(), language: j.language ?? language });
          } catch (e) {
            const timedOut = (e as { name?: string }).name === 'AbortError';
            send(res, timedOut ? 504 : 502, {
              error: timedOut
                ? 'The speech service took too long.'
                : 'Could not reach the speech service.',
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
