// @vitest-environment node
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';
import { createAiProxy, isPrivateUrl } from './aiProxy';

const servers: Server[] = [];
afterEach(() => {
  servers.splice(0).forEach((s) => s.close());
});

const listen = (s: Server) =>
  new Promise<string>((resolve) => {
    servers.push(s);
    s.listen(0, '127.0.0.1', () =>
      resolve(`http://127.0.0.1:${(s.address() as AddressInfo).port}`),
    );
  });

/** A fake Ollama that records what it was asked and answers like the real one. */
async function fakeOllama(delay = 0) {
  const seen: { url: string; body: string; at: number }[] = [];
  const url = await listen(
    createServer((req, res) => {
      let body = '';
      req.on('data', (c) => (body += c));
      req.on('end', () => {
        const at = Date.now();
        seen.push({ url: req.url ?? '', body, at });
        setTimeout(() => {
          res.setHeader('Content-Type', 'application/json');
          res.end(
            req.url === '/api/tags'
              ? JSON.stringify({ models: [{ name: 'qwen3:14b' }] })
              : JSON.stringify({
                  message: { content: '{"ok":true}' },
                  echo: JSON.parse(body || '{}'),
                }),
          );
        }, delay);
      });
    }),
  );
  return { url, seen };
}

async function proxy(opts: Parameters<typeof createAiProxy>[0]) {
  const handler = createAiProxy(opts);
  return listen(createServer((req, res) => void handler(req, res)));
}

const post = (base: string, body: unknown) =>
  fetch(base, { method: 'POST', body: typeof body === 'string' ? body : JSON.stringify(body) });

describe('AI proxy', () => {
  it('forwards chat requests to Ollama and tag listings', async () => {
    const up = await fakeOllama();
    const base = await proxy({ ollamaUrl: up.url });
    const chat = await post(base, {
      target: 'ollama',
      path: '/api/chat',
      body: { model: 'm', messages: [] },
    });
    expect(chat.status).toBe(200);
    expect(((await chat.json()) as { echo: { model: string } }).echo.model).toBe('m');
    const tags = await post(base, { target: 'ollama', path: '/api/tags', method: 'GET' });
    expect(((await tags.json()) as { models: { name: string }[] }).models[0]!.name).toBe(
      'qwen3:14b',
    );
    expect(up.seen.map((s) => s.url)).toEqual(['/api/chat', '/api/tags']);
  });

  it('only forwards allow-listed paths and valid envelopes', async () => {
    const up = await fakeOllama();
    const base = await proxy({ ollamaUrl: up.url });
    expect((await post(base, { target: 'ollama', path: '/api/pull', body: {} })).status).toBe(403);
    expect((await post(base, { target: 'ollama', path: '/api/delete' })).status).toBe(403);
    expect((await post(base, { target: 'nope', path: '/api/chat' })).status).toBe(400);
    expect((await post(base, 'not json')).status).toBe(400);
    expect((await fetch(base, { method: 'GET' })).status).toBe(405);
    expect(up.seen).toHaveLength(0);
  });

  it('limits body size', async () => {
    const up = await fakeOllama();
    const base = await proxy({ ollamaUrl: up.url, maxBody: 200 });
    const big = await post(base, {
      target: 'ollama',
      path: '/api/chat',
      body: { x: 'y'.repeat(500) },
    });
    expect(big.status).toBe(413);
  });

  it('reports an unreachable model with a friendly 502', async () => {
    const base = await proxy({ ollamaUrl: 'http://127.0.0.1:1' });
    const r = await post(base, { target: 'ollama', path: '/api/chat', body: {} });
    expect(r.status).toBe(502);
    expect(await r.json()).toMatchObject({ code: 'unreachable' });
  });

  it('times out slow models', async () => {
    const up = await fakeOllama(400);
    const base = await proxy({ ollamaUrl: up.url, timeoutMs: 80 });
    const r = await post(base, { target: 'ollama', path: '/api/chat', body: {} });
    expect(r.status).toBe(504);
    expect(await r.json()).toMatchObject({ code: 'timeout' });
  });

  it('runs one generation at a time (queued), but lets listing calls through', async () => {
    const up = await fakeOllama(150);
    const base = await proxy({ ollamaUrl: up.url });
    const started = Date.now();
    const [a, b] = await Promise.all([
      post(base, { target: 'ollama', path: '/api/chat', body: { n: 1 } }),
      post(base, { target: 'ollama', path: '/api/chat', body: { n: 2 } }),
    ]);
    expect([a.status, b.status]).toEqual([200, 200]);
    expect(Date.now() - started).toBeGreaterThanOrEqual(280); // 2 × 150 ms, one after the other
    const [c1, c2] = up.seen.filter((s) => s.url === '/api/chat');
    expect(c2!.at - c1!.at).toBeGreaterThanOrEqual(140);
  });

  it('the OpenAI-compatible target is limited to this machine / the home network', async () => {
    const up = await fakeOllama();
    const base = await proxy({ ollamaUrl: up.url });
    const lan = await post(base, {
      target: 'openai',
      baseUrl: up.url + '/v1',
      path: '/models',
      method: 'GET',
    });
    expect(lan.status).not.toBe(400); // loopback is fine (the fake answers 200)
    expect(
      (
        await post(base, {
          target: 'openai',
          baseUrl: 'https://api.openai.com/v1',
          path: '/chat/completions',
          body: {},
        })
      ).status,
    ).toBe(400);
    expect(isPrivateUrl('http://192.168.1.20:1234/v1')).toBe(true);
    expect(isPrivateUrl('http://localhost:1234')).toBe(true);
    expect(isPrivateUrl('https://example.com')).toBe(false);
    expect(isPrivateUrl('ftp://localhost')).toBe(false);
    expect(isPrivateUrl('nonsense')).toBe(false);
    expect(
      (await post(base, { target: 'openai', baseUrl: up.url, path: '/etc/passwd' })).status,
    ).toBe(403);
  });
});
