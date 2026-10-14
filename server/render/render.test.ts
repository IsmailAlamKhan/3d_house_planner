// @vitest-environment node
import { mkdtempSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { WebSocketServer } from 'ws';
import { afterEach, describe, expect, it } from 'vitest';
import { createApp } from '../app';
import { buildWorkflow } from './workflow';
import { EnhanceParamsSchema } from '../../src/render/protocol';

const servers: Server[] = [];
afterEach(() => servers.splice(0).forEach((s) => s.close()));
const listen = (s: Server) =>
  new Promise<string>((resolve) => {
    servers.push(s);
    s.listen(0, '127.0.0.1', () =>
      resolve(`http://127.0.0.1:${(s.address() as AddressInfo).port}`),
    );
  });

const PNG = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  Buffer.alloc(120, 7),
]);
const dataUrl = (b: Buffer = PNG) => `data:image/png;base64,${b.toString('base64')}`;

/** A pretend ComfyUI: records what it was asked and "renders" over the websocket. */
async function fakeComfy(
  opts: { steps?: number; hold?: Promise<void>; emptyHistoryCalls?: number } = {},
) {
  const log = {
    uploads: [] as string[],
    prompts: [] as {
      prompt: Record<string, { inputs: Record<string, unknown> }>;
      client_id: string;
    }[],
    freed: 0,
    interrupted: 0,
    historyCalls: 0,
  };
  const sockets = new Map<string, import('ws').WebSocket>();
  const server = createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => {
      const body = Buffer.concat(chunks);
      const url = new URL(req.url ?? '/', 'http://x');
      const json = (o: unknown, status = 200) => {
        res.statusCode = status;
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify(o));
      };
      if (url.pathname === '/system_stats') return json({ system: {} });
      if (url.pathname === '/upload/image') {
        const name = /filename="([^"]+)"/.exec(body.toString('latin1'))?.[1] ?? 'x.png';
        log.uploads.push(name);
        return json({ name, subfolder: '', type: 'input' });
      }
      if (url.pathname === '/prompt') {
        const j = JSON.parse(body.toString());
        log.prompts.push(j);
        const ws = sockets.get(j.client_id);
        void (async () => {
          await opts.hold;
          for (let i = 1; i <= (opts.steps ?? 3); i++) {
            ws?.send(
              JSON.stringify({
                type: 'progress',
                data: { value: i, max: opts.steps ?? 3, prompt_id: 'p1' },
              }),
            );
            await new Promise((r) => setTimeout(r, 5));
          }
          ws?.send(JSON.stringify({ type: 'executing', data: { node: null, prompt_id: 'p1' } }));
        })();
        return json({ prompt_id: 'p1' });
      }
      if (url.pathname === '/history/p1') {
        // Real ComfyUI announces the end on the socket before it stores the result in /history.
        if (log.historyCalls++ < (opts.emptyHistoryCalls ?? 0)) return json({});
        return json({
          p1: {
            status: { status_str: 'success' },
            outputs: { '14': { images: [{ filename: 'out.png', subfolder: '', type: 'output' }] } },
          },
        });
      }
      if (url.pathname === '/view') {
        res.setHeader('Content-Type', 'image/png');
        return void res.end(Buffer.concat([PNG, Buffer.from('RESULT')]));
      }
      if (url.pathname === '/free') {
        log.freed++;
        return json({});
      }
      if (url.pathname === '/interrupt') {
        log.interrupted++;
        return json({});
      }
      json({ error: 'nope' }, 404);
    });
  });
  const wss = new WebSocketServer({ server, path: '/ws' });
  wss.on('connection', (ws, req) => {
    const id = new URL(req.url ?? '', 'http://x').searchParams.get('clientId') ?? '';
    sockets.set(id, ws);
  });
  const url = await listen(server);
  return { url, log };
}

async function fakeOllama(log: { unloaded: string[]; chatGate?: Promise<void> }) {
  const server = createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', async () => {
      const body = Buffer.concat(chunks).toString();
      if (req.url === '/api/ps')
        return void res.end(JSON.stringify({ models: [{ name: 'qwen3:14b' }] }));
      if (req.url === '/api/tags') return void res.end(JSON.stringify({ models: [] }));
      if (req.url === '/api/generate') {
        const j = JSON.parse(body);
        if (j.keep_alive === 0) log.unloaded.push(j.model);
        return void res.end('{}');
      }
      if (req.url === '/api/chat') {
        await log.chatGate;
        return void res.end(JSON.stringify({ message: { content: '{}' } }));
      }
      res.statusCode = 404;
      res.end('{}');
    });
  });
  return listen(server);
}

const request = (over: Record<string, unknown> = {}) => ({
  projectId: 'proj-1',
  projectName: 'My home',
  params: {
    prompt: 'luxury modern interior, warm dusk lighting',
    negative: 'text, watermark',
    creativity: 0.35,
    controlStrength: 0.8,
    seed: 1234,
    steps: 20,
    upscale: false,
  },
  images: { color: dataUrl(), depth: dataUrl(), edge: dataUrl() },
  view: {
    viewProjection: Array.from({ length: 16 }, (_, i) => (i % 5 === 0 ? 1 : 0)),
    width: 1024,
    height: 768,
  },
  labels: [
    { roomId: 'r1', title: 'Living room', detail: "14' x 12'", world: { x: 1, y: 0.05, z: 2 } },
  ],
  ...over,
});

async function app(comfyUrl: string | null, ollamaUrl = 'http://127.0.0.1:9') {
  const dist = mkdtempSync(join(tmpdir(), 'dd-dist-'));
  const handle = createApp({
    port: 0,
    host: '127.0.0.1',
    ollamaUrl,
    comfyUrl,
    model: 'qwen3:14b',
    visionModel: 'v',
    password: null,
    distDir: dist,
    dataDir: ':memory:',
  });
  return listen(handle.server);
}

const post = (url: string, body: unknown) =>
  fetch(url + '/api/render/enhance', { method: 'POST', body: JSON.stringify(body) });

async function waitFor(url: string, id: string, pred: (j: Record<string, unknown>) => boolean) {
  for (let i = 0; i < 400; i++) {
    const j = (await (await fetch(`${url}/api/render/jobs/${id}`)).json()) as Record<
      string,
      unknown
    >;
    if (pred(j)) return j;
    await new Promise((r) => setTimeout(r, 10));
  }
  throw new Error('timed out waiting for the job');
}

describe('/api/render', () => {
  it('health says whether the image service is configured and reachable', async () => {
    const comfy = await fakeComfy();
    expect(
      (await (await fetch((await app(comfy.url)) + '/api/health')).json()).render,
    ).toMatchObject({
      configured: true,
      reachable: true,
    });
    expect(
      (await (await fetch((await app('http://127.0.0.1:9')) + '/api/health')).json()).render,
    ).toEqual({ configured: true, reachable: false });
    expect((await (await fetch((await app(null)) + '/api/health')).json()).render).toEqual({
      configured: false,
      reachable: false,
    });
  });

  it('runs a job end to end: uploads the three images, sends the workflow, relays progress, stores the result', async () => {
    const comfy = await fakeComfy({ steps: 4 });
    const ollama = { unloaded: [] as string[] };
    const url = await app(comfy.url, await fakeOllama(ollama));
    const r = await post(url, request());
    expect(r.status).toBe(202);
    const { id } = (await r.json()) as { id: string };
    const done = await waitFor(url, id, (j) => j.status === 'done');
    expect(done.progress).toEqual({ step: 4, max: 4 });

    expect(comfy.log.uploads.sort()).toEqual([
      `duplex-${id}-color.png`,
      `duplex-${id}-depth.png`,
      `duplex-${id}-edge.png`,
    ]);
    const sent = comfy.log.prompts[0]!;
    expect(sent.client_id).toBe(id);
    expect(sent.prompt['12']!.inputs).toMatchObject({ seed: 1234, steps: 20, denoise: 0.35 });
    expect(sent.prompt['7']!.inputs.text).toContain('warm dusk');
    // The language model is unloaded before the render and ComfyUI frees its memory after it.
    expect(ollama.unloaded).toEqual(['qwen3:14b']);
    await waitFor(url, id, () => comfy.log.freed > 0);

    const img = await fetch(`${url}/api/render/results/${id}`);
    expect(img.headers.get('content-type')).toBe('image/png');
    expect(Buffer.from(await img.arrayBuffer()).toString('latin1')).toContain('RESULT');
    expect((await fetch(`${url}/api/render/results/${id}/before`)).status).toBe(200);
    const meta = await (await fetch(`${url}/api/render/results/${id}/meta`)).json();
    expect(meta).toMatchObject({
      id,
      projectId: 'proj-1',
      params: { seed: 1234 },
      hasEdge: true,
      workflow: 1,
    });
    expect(meta.labels[0].title).toBe('Living room');

    const list = await (await fetch(`${url}/api/render/results?project=proj-1`)).json();
    expect(list.map((m: { id: string }) => m.id)).toEqual([id]);
    expect(await (await fetch(`${url}/api/render/results?project=other`)).json()).toEqual([]);
    expect((await fetch(`${url}/api/render/results/${id}`, { method: 'DELETE' })).status).toBe(200);
    expect((await fetch(`${url}/api/render/results/${id}`)).status).toBe(404);
  });

  it('still finds the picture when ComfyUI reports the end before it has stored the result', async () => {
    const comfy = await fakeComfy({ emptyHistoryCalls: 4 });
    const url = await app(comfy.url, await fakeOllama({ unloaded: [] }));
    const { id } = (await (await post(url, request())).json()) as { id: string };
    const done = await waitFor(url, id, (j) => j.status === 'done' || j.status === 'error');
    expect(done.status).toBe('done');
    expect(comfy.log.historyCalls).toBeGreaterThan(4);
  });

  it('an AI design job and a render job take turns: the render waits and says who is ahead', async () => {
    let release!: () => void;
    const chatGate = new Promise<void>((r) => (release = r));
    const comfy = await fakeComfy();
    const url = await app(comfy.url, await fakeOllama({ unloaded: [], chatGate }));
    const chat = fetch(url + '/api/ai', {
      method: 'POST',
      body: JSON.stringify({
        target: 'ollama',
        path: '/api/chat',
        body: { model: 'm', messages: [] },
      }),
    });
    await new Promise((r) => setTimeout(r, 50)); // the design job is now on the GPU
    const { id } = (await (await post(url, request())).json()) as { id: string };
    const waiting = await waitFor(url, id, (j) => j.status === 'queued');
    expect(waiting).toMatchObject({ ahead: 1, gpuBusyWith: 'design' });
    expect(comfy.log.prompts).toHaveLength(0); // not started while the language model works
    release();
    await chat;
    await waitFor(url, id, (j) => j.status === 'done');
    expect(comfy.log.prompts).toHaveLength(1);
  });

  it('a waiting job can be cancelled and never reaches ComfyUI', async () => {
    let release!: () => void;
    const chatGate = new Promise<void>((r) => (release = r));
    const comfy = await fakeComfy();
    const url = await app(comfy.url, await fakeOllama({ unloaded: [], chatGate }));
    const chat = fetch(url + '/api/ai', {
      method: 'POST',
      body: JSON.stringify({
        target: 'ollama',
        path: '/api/chat',
        body: { model: 'm', messages: [] },
      }),
    });
    await new Promise((r) => setTimeout(r, 50));
    const { id } = (await (await post(url, request())).json()) as { id: string };
    const res = await fetch(`${url}/api/render/jobs/${id}`, { method: 'DELETE' });
    expect((await res.json()).status).toBe('cancelled');
    release();
    await chat;
    await new Promise((r) => setTimeout(r, 50));
    expect(comfy.log.prompts).toHaveLength(0);
  });

  it('re-runs a stored result with a new seed using the same pictures', async () => {
    const comfy = await fakeComfy();
    const url = await app(comfy.url);
    const { id } = (await (await post(url, request())).json()) as { id: string };
    await waitFor(url, id, (j) => j.status === 'done');
    const again = await fetch(`${url}/api/render/results/${id}/rerun`, {
      method: 'POST',
      body: JSON.stringify({ seed: 777 }),
    });
    expect(again.status).toBe(202);
    const second = ((await again.json()) as { id: string }).id;
    expect(second).not.toBe(id);
    await waitFor(url, second, (j) => j.status === 'done');
    expect(comfy.log.prompts).toHaveLength(2);
    expect(comfy.log.prompts[1]!.prompt['12']!.inputs.seed).toBe(777);
    expect(comfy.log.prompts[1]!.prompt['7']!.inputs.text).toBe(
      comfy.log.prompts[0]!.prompt['7']!.inputs.text,
    );
    const meta = await (await fetch(`${url}/api/render/results/${second}/meta`)).json();
    expect(meta.params.seed).toBe(777);
    expect(meta.labels).toHaveLength(1);
    expect(
      (await fetch(`${url}/api/render/results/${'0'.repeat(16)}/rerun`, { method: 'POST' })).status,
    ).toBe(404);
  });

  it('refuses politely when the service is missing or down, and rejects bad requests', async () => {
    const none = await app(null);
    const a = await post(none, request());
    expect(a.status).toBe(503);
    expect((await a.json()).code).toBe('not-configured');
    const down = await app('http://127.0.0.1:9');
    const b = await post(down, request());
    expect(b.status).toBe(503);
    expect((await b.json()).code).toBe('unreachable');
    const comfy = await fakeComfy();
    const url = await app(comfy.url);
    expect((await post(url, { nope: true })).status).toBe(400);
    expect(
      (await post(url, request({ params: { ...request().params, creativity: 0.9 } }))).status,
    ).toBe(400);
    const bad = (await (
      await post(
        url,
        request({
          images: {
            color: dataUrl(Buffer.from('not a png at all, definitely not a png')),
            depth: dataUrl(),
          },
        }),
      )
    ).json()) as { id: string };
    const failed = await waitFor(url, bad.id, (j) => j.status === 'error');
    expect(failed.error).toMatch(/PNG/);
    expect((await fetch(url + '/api/render/jobs/zzzz')).status).toBe(404);
    expect((await fetch(url + '/api/render/nothing')).status).toBe(404);
  });

  it('requires the password like every other API when one is set', async () => {
    const dist = mkdtempSync(join(tmpdir(), 'dd-dist-'));
    const h = createApp({
      port: 0,
      host: '127.0.0.1',
      ollamaUrl: 'http://127.0.0.1:9',
      comfyUrl: null,
      model: 'm',
      visionModel: 'v',
      password: 'x',
      distDir: dist,
      dataDir: ':memory:',
    });
    const url = await listen(h.server);
    expect((await post(url, request())).status).toBe(401);
  });
});

describe('workflow template', () => {
  const params = EnhanceParamsSchema.parse({ prompt: 'a lovely room', negative: 'blur', seed: 5 });
  const files = { color: 'c.png', depth: 'd.png' };

  it('without edges or upscale: depth ControlNet only, one sampler', () => {
    const w = buildWorkflow(params, files);
    expect(w['4']).toBeUndefined();
    expect(w['10']).toBeUndefined();
    expect(w['15']).toBeUndefined();
    expect(w['12']!.inputs.positive).toEqual(['9', 0]);
    expect(w['14']!.inputs.images).toEqual(['13', 0]);
    expect(w['2']!.inputs.image).toBe('c.png');
    expect(w['12']!.inputs).toMatchObject({ seed: 5, steps: 28, denoise: 0.35 });
    // Every connection points at a node that exists.
    for (const n of Object.values(w))
      for (const v of Object.values(n.inputs))
        if (Array.isArray(v)) expect(w[String(v[0])]).toBeDefined();
  });

  it('with edges and upscale: canny ControlNet chained and a second pass saved', () => {
    const w = buildWorkflow(
      { ...params, upscale: true, creativity: 0.5 },
      { ...files, edge: 'e.png' },
    );
    expect(w['4']!.inputs.image).toBe('e.png');
    expect(w['12']!.inputs.positive).toEqual(['10', 0]);
    expect(w['14']!.inputs.images).toEqual(['18', 0]);
    expect(w['17']!.inputs.seed).toBe(5);
    for (const n of Object.values(w))
      for (const v of Object.values(n.inputs))
        if (Array.isArray(v)) expect(w[String(v[0])]).toBeDefined();
  });
});
