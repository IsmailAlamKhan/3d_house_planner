// @vitest-environment node
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';
import { GpuQueue } from '../gpuQueue';
import { createVoiceService, looksLikeWav } from './voiceApi';

const servers: Server[] = [];
afterEach(() => servers.splice(0).forEach((s) => s.close()));
const listen = (s: Server) =>
  new Promise<string>((resolve) => {
    servers.push(s);
    s.listen(0, '127.0.0.1', () =>
      resolve(`http://127.0.0.1:${(s.address() as AddressInfo).port}`),
    );
  });

/** A tiny valid WAV header plus silence. */
function wav(): Buffer {
  const b = Buffer.alloc(44 + 3200);
  b.write('RIFF', 0, 'ascii');
  b.writeUInt32LE(b.length - 8, 4);
  b.write('WAVE', 8, 'ascii');
  b.write('fmt ', 12, 'ascii');
  b.writeUInt32LE(16, 16);
  b.writeUInt16LE(1, 20);
  b.writeUInt16LE(1, 22);
  b.writeUInt32LE(16000, 24);
  b.writeUInt32LE(32000, 28);
  b.writeUInt16LE(2, 32);
  b.writeUInt16LE(16, 34);
  b.write('data', 36, 'ascii');
  b.writeUInt32LE(3200, 40);
  return b;
}

async function setup(whisper: ((fields: string[]) => { status?: number; json: unknown }) | null) {
  const seen: string[][] = [];
  const whisperUrl = whisper
    ? await listen(
        createServer((req, res) => {
          const chunks: Buffer[] = [];
          req.on('data', (c: Buffer) => chunks.push(c));
          req.on('end', () => {
            if (req.method === 'GET') {
              res.end('ok');
              return;
            }
            const text = Buffer.concat(chunks).toString('latin1');
            const fields = [...text.matchAll(/name="(\w+)"/g)].map((m) => m[1]!);
            seen.push(fields);
            const r = whisper(fields);
            res.statusCode = r.status ?? 200;
            res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify(r.json));
          });
        }),
      )
    : null;
  const svc = createVoiceService({ whisperUrl, queue: new GpuQueue(), timeoutMs: 2000 });
  const base = await listen(
    createServer((req, res) => {
      const u = new URL(req.url ?? '/', 'http://x');
      void svc.handle(req, res, u.pathname, u.searchParams).then((h) => {
        if (!h) {
          res.statusCode = 404;
          res.end();
        }
      });
    }),
  );
  return { base, seen };
}

describe('voice service', () => {
  it('recognises a WAV header', () => {
    expect(looksLikeWav(wav())).toBe(true);
    expect(
      looksLikeWav(
        Buffer.from('not audio at all, just some text bytes here........................'),
      ),
    ).toBe(false);
  });

  it('reports whether the speech service is configured and reachable', async () => {
    const none = await setup(null);
    expect(await (await fetch(`${none.base}/api/voice/health`)).json()).toEqual({
      configured: false,
      reachable: false,
    });
    const ok = await setup(() => ({ json: { text: 'x' } }));
    expect(await (await fetch(`${ok.base}/api/voice/health`)).json()).toEqual({
      configured: true,
      reachable: true,
    });
  });

  it('sends the recording to whisper and returns the text', async () => {
    const { base, seen } = await setup(() => ({
      json: { text: ' three bedroom villa ', language: 'en' },
    }));
    const r = await fetch(`${base}/api/voice/transcribe?language=en`, {
      method: 'POST',
      body: new Uint8Array(wav()),
    });
    expect(r.status).toBe(200);
    expect(await r.json()).toEqual({ text: 'three bedroom villa', language: 'en' });
    expect(seen[0]).toEqual(expect.arrayContaining(['file', 'response_format', 'language']));
  });

  it('refuses things that are not WAV, an unconfigured service, and a failing upstream', async () => {
    const { base } = await setup(() => ({ status: 500, json: { error: 'boom' } }));
    expect(
      (await fetch(`${base}/api/voice/transcribe`, { method: 'POST', body: 'hello' })).status,
    ).toBe(400);
    expect(
      (await fetch(`${base}/api/voice/transcribe`, { method: 'POST', body: new Uint8Array(wav()) }))
        .status,
    ).toBe(502);
    expect((await fetch(`${base}/api/voice/transcribe`)).status).toBe(405);
    const none = await setup(null);
    const r = await fetch(`${none.base}/api/voice/transcribe`, {
      method: 'POST',
      body: new Uint8Array(wav()),
    });
    expect(r.status).toBe(404);
    expect(((await r.json()) as { code: string }).code).toBe('no-voice');
  });
});
