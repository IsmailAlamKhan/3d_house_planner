// @vitest-environment node
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';
import { GpuQueue } from '../gpuQueue';
import { cleanImage, createVisionService } from './visionApi';

const servers: Server[] = [];
afterEach(() => servers.splice(0).forEach((s) => s.close()));
const listen = (s: Server) =>
  new Promise<string>((resolve) => {
    servers.push(s);
    s.listen(0, '127.0.0.1', () =>
      resolve(`http://127.0.0.1:${(s.address() as AddressInfo).port}`),
    );
  });

const BIG_ENOUGH = 'QUJD'.repeat(40);

async function setup(
  upstream: (body: Record<string, unknown>) => { status?: number; json: unknown },
) {
  const seen: Record<string, unknown>[] = [];
  const ollama = await listen(
    createServer((req, res) => {
      let b = '';
      req.on('data', (c) => (b += c));
      req.on('end', () => {
        const body = JSON.parse(b) as Record<string, unknown>;
        seen.push(body);
        const r = upstream(body);
        res.statusCode = r.status ?? 200;
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify(r.json));
      });
    }),
  );
  const queue = new GpuQueue();
  const svc = createVisionService({
    ollamaUrl: ollama,
    model: 'qwen3-vl:8b-instruct',
    queue,
    timeoutMs: 2000,
  });
  const base = await listen(
    createServer((req, res) => {
      void svc.handle(req, res, new URL(req.url ?? '/', 'http://x').pathname).then((h) => {
        if (!h) {
          res.statusCode = 404;
          res.end();
        }
      });
    }),
  );
  return { base, seen, queue };
}

const post = (base: string, body: unknown) =>
  fetch(`${base}/api/vision`, { method: 'POST', body: JSON.stringify(body) });

describe('/api/vision', () => {
  it('asks the vision model with the pictures, the schema and temperature 0, and returns its answer', async () => {
    const { base, seen } = await setup(() => ({ json: { message: { content: '{"labels":[]}' } } }));
    const schema = { type: 'object', properties: { labels: { type: 'array' } } };
    const r = await post(base, {
      prompt: 'read the labels',
      system: 'you read plans',
      images: [`data:image/png;base64,${BIG_ENOUGH}`],
      schema,
    });
    expect(r.status).toBe(200);
    expect(await r.json()).toEqual({ content: '{"labels":[]}', model: 'qwen3-vl:8b-instruct' });
    const body = seen[0]!;
    expect(body.model).toBe('qwen3-vl:8b-instruct');
    expect(body.format).toEqual(schema);
    expect(body.stream).toBe(false);
    const msgs = body.messages as { role: string; content: string; images?: string[] }[];
    expect(msgs.map((m) => m.role)).toEqual(['system', 'user']);
    expect(msgs[1]!.images).toEqual([BIG_ENOUGH]); // raw base64, no data-URL prefix
    expect((body.options as { temperature: number }).temperature).toBe(0);
  });

  it('refuses requests without a prompt or with unusable pictures', async () => {
    const { base, seen } = await setup(() => ({ json: {} }));
    expect((await post(base, { prompt: 'x', images: [] })).status).toBe(400);
    expect((await post(base, { prompt: '', images: [BIG_ENOUGH] })).status).toBe(400);
    expect((await post(base, { prompt: 'x', images: ['not base64 !!'] })).status).toBe(400);
    expect((await post(base, { prompt: 'x', images: Array(5).fill(BIG_ENOUGH) })).status).toBe(400);
    expect((await fetch(`${base}/api/vision`)).status).toBe(405);
    expect(seen).toHaveLength(0);
  });

  it('says how to install a missing model, and reports a model server that is down', async () => {
    const { base } = await setup(() => ({
      status: 404,
      json: { error: 'model "qwen3-vl:8b-instruct" not found' },
    }));
    const r = await post(base, { prompt: 'x', images: [BIG_ENOUGH] });
    expect(r.status).toBe(404);
    expect(await r.json()).toMatchObject({
      code: 'no-model',
      error: expect.stringContaining('ollama pull qwen3-vl:8b-instruct'),
    });
    const queue = new GpuQueue();
    const dead = createVisionService({ ollamaUrl: 'http://127.0.0.1:1', model: 'm', queue });
    const b2 = await listen(createServer((q, s) => void dead.handle(q, s, '/api/vision')));
    const r2 = await post(b2, { prompt: 'x', images: [BIG_ENOUGH] });
    expect(r2.status).toBe(502);
    expect(await r2.json()).toMatchObject({ code: 'unreachable' });
  });

  it('takes its turn on the GPU queue, and the models are swapped when vision and design alternate', async () => {
    const log: string[] = [];
    const queue = new GpuQueue({
      beforeSwitch: async (from, to) => void log.push(`${from}->${to}`),
    });
    await queue.run('design', async () => void log.push('design'));
    await queue.run('vision', async () => void log.push('vision'));
    await queue.run('vision', async () => void log.push('vision again'));
    await queue.run('design', async () => void log.push('design again'));
    expect(log).toEqual([
      'design',
      'design->vision',
      'vision',
      'vision again',
      'vision->design',
      'design again',
    ]);
  });

  it('cleanImage accepts data URLs and base64 and rejects the rest', () => {
    expect(cleanImage(`data:image/jpeg;base64,${BIG_ENOUGH}`)).toBe(BIG_ENOUGH);
    expect(cleanImage(BIG_ENOUGH)).toBe(BIG_ENOUGH);
    expect(cleanImage('abc')).toBeNull();
    expect(cleanImage(42)).toBeNull();
  });
});
