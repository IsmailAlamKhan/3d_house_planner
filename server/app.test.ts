// @vitest-environment node
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { createServer, request as httpRequest, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createApp } from './app';
import { loadConfig, parseEnv } from './config';

const servers: Server[] = [];
afterEach(() => servers.splice(0).forEach((s) => s.close()));
const listen = (s: Server, host = '127.0.0.1') =>
  new Promise<string>((resolve) => {
    servers.push(s);
    s.listen(0, host, () => resolve(`http://127.0.0.1:${(s.address() as AddressInfo).port}`));
  });

function dist() {
  const d = mkdtempSync(join(tmpdir(), 'dd-dist-'));
  mkdirSync(join(d, 'assets'));
  writeFileSync(join(d, 'index.html'), '<!doctype html><title>App</title>');
  writeFileSync(join(d, 'assets', 'a.js'), 'console.log(1)');
  writeFileSync(join(d, 'manifest.webmanifest'), '{}');
  return d;
}

async function fakeOllama() {
  return listen(
    createServer((req, res) => {
      let body = '';
      req.on('data', (c) => (body += c));
      req.on('end', () => {
        if (req.url === '/api/tags')
          return void res.end(JSON.stringify({ models: [{ name: 'qwen3:14b' }] }));
        const wantsStream = JSON.parse(body || '{}').stream === true;
        if (wantsStream) {
          res.setHeader('Content-Type', 'application/x-ndjson');
          res.write(JSON.stringify({ message: { content: '{"a":' }, done: false }) + '\n');
          setTimeout(() => {
            res.write(JSON.stringify({ message: { content: '1}' }, done: false }) + '\n');
            res.end(JSON.stringify({ message: { content: '' }, done: true }) + '\n');
          }, 20);
        } else res.end(JSON.stringify({ message: { content: '{"a":1}' } }));
      });
    }),
  );
}

const config = (over: object = {}) => ({
  port: 0,
  host: '127.0.0.1',
  ollamaUrl: 'http://127.0.0.1:9',
  model: 'qwen3:14b',
  password: null,
  distDir: dist(),
  dataDir: ':memory:',
  ...over,
});

describe('configuration', () => {
  it('parses .env text and applies defaults', () => {
    expect(parseEnv('# c\nPORT=9000\nHOST = "0.0.0.0"\nAPP_PASSWORD=pa ss # note\n\nbad')).toEqual({
      PORT: '9000',
      HOST: '0.0.0.0',
      APP_PASSWORD: 'pa ss',
    });
    const c = loadConfig({}, '/nonexistent.env');
    expect(c).toMatchObject({
      port: 8080,
      host: '0.0.0.0',
      ollamaUrl: 'http://127.0.0.1:11434',
      model: 'qwen3:14b',
      password: null,
    });
    expect(
      loadConfig({ PORT: 'abc', OLLAMA_URL: 'http://x:1/', APP_PASSWORD: 'p' }, '/nonexistent.env'),
    ).toMatchObject({ port: 8080, ollamaUrl: 'http://x:1', password: 'p' });
  });
});

describe('static files', () => {
  it('serves the build, falls back to the app for routes, 404s for missing files, blocks path tricks', async () => {
    const url = await listen(createApp(config()).server);
    expect(await (await fetch(url + '/')).text()).toContain('<title>App</title>');
    const deep = await fetch(url + '/some/route');
    expect(deep.status).toBe(200);
    expect(await deep.text()).toContain('<title>App</title>');
    const asset = await fetch(url + '/assets/a.js');
    expect(asset.headers.get('content-type')).toContain('javascript');
    expect(asset.headers.get('cache-control')).toContain('immutable');
    expect((await fetch(url + '/index.html')).headers.get('cache-control')).toBe('no-cache');
    expect((await fetch(url + '/missing.js')).status).toBe(404);
    // A raw request that climbs out of the build folder is refused (fetch would tidy the path, so go lower level).
    const raw = await new Promise<{ status: number; body: string }>((ok) => {
      const u = new URL(url);
      httpRequest(
        { host: u.hostname, port: u.port, path: '/..%2f..%2f..%2fetc/passwd', method: 'GET' },
        (r) => {
          let body = '';
          r.on('data', (c) => (body += c));
          r.on('end', () => ok({ status: r.statusCode ?? 0, body }));
        },
      ).end();
    });
    expect(raw.body).not.toContain('root:');
    expect((await fetch(url + '/', { method: 'POST' })).status).toBe(405);
  });

  it('says so when the app has not been built', async () => {
    const url = await listen(createApp(config({ distDir: join(tmpdir(), 'dd-nothing') })).server);
    expect((await fetch(url + '/')).status).toBe(503);
  });
});

describe('/api/health', () => {
  it('reports Ollama and the installed models, or that it is down', async () => {
    const ollama = await fakeOllama();
    const up = await (
      await fetch((await listen(createApp(config({ ollamaUrl: ollama })).server)) + '/api/health')
    ).json();
    expect(up).toMatchObject({
      app: 'ok',
      model: 'qwen3:14b',
      ollama: { reachable: true, models: ['qwen3:14b'], modelInstalled: true },
      authRequired: false,
    });
    const down = await (
      await fetch((await listen(createApp(config()).server)) + '/api/health')
    ).json();
    expect(down).toMatchObject({
      app: 'ok',
      ollama: { reachable: false, models: [], modelInstalled: false },
    });
    const other = await (
      await fetch(
        (await listen(createApp(config({ ollamaUrl: ollama, model: 'gemma3:12b' })).server)) +
          '/api/health',
      )
    ).json();
    expect(other.ollama.modelInstalled).toBe(false);
  });
});

describe('/api/ai through the app server', () => {
  const post = (url: string, body: unknown) =>
    fetch(url + '/api/ai', { method: 'POST', body: JSON.stringify(body) });

  it('forwards only the allow-listed Ollama calls', async () => {
    const ollama = await fakeOllama();
    const url = await listen(createApp(config({ ollamaUrl: ollama })).server);
    const ok = await post(url, {
      target: 'ollama',
      path: '/api/chat',
      body: { model: 'm', messages: [] },
    });
    expect((await ok.json()).message.content).toBe('{"a":1}');
    expect((await post(url, { target: 'ollama', path: '/api/pull' })).status).toBe(403);
  });

  it('streams: queue position, progress and the assembled answer', async () => {
    const ollama = await fakeOllama();
    const url = await listen(createApp(config({ ollamaUrl: ollama })).server);
    const body = {
      target: 'ollama',
      path: '/api/chat',
      stream: true,
      body: { model: 'm', messages: [] },
    };
    const [a, b] = await Promise.all([post(url, body), post(url, body)]);
    const lines = async (r: Response) =>
      (await r.text())
        .trim()
        .split('\n')
        .map((l) => JSON.parse(l) as { type: string; ahead?: number });
    const la = await lines(a);
    const lb = await lines(b);
    expect(a.headers.get('content-type')).toContain('ndjson');
    const all = [la, lb];
    // Exactly one of the two had to wait its turn.
    expect(all.filter((l) => l.some((e) => e.type === 'queued')).length).toBe(1);
    for (const l of all) {
      expect(l.some((e) => e.type === 'start')).toBe(true);
      expect(l.at(-1)!.type).toBe('end');
      expect(l.filter((e) => e.type === 'data').length).toBeGreaterThanOrEqual(2);
    }
  });
});

describe('password', () => {
  it('asks for it, accepts the right one once, keeps a session cookie, and lets you sign out', async () => {
    const app = createApp(config({ password: 'sesame' }));
    const url = await listen(app.server);
    const page = await fetch(url + '/');
    expect(page.status).toBe(401);
    expect(await page.text()).toContain('type="password"');
    expect((await fetch(url + '/api/ai', { method: 'POST', body: '{}' })).status).toBe(401);
    expect((await (await fetch(url + '/api/health')).json()).authRequired).toBe(true); // health stays public

    const wrong = await fetch(url + '/api/login', {
      method: 'POST',
      body: 'password=nope',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    });
    expect(wrong.status).toBe(401);
    const right = await fetch(url + '/api/login', {
      method: 'POST',
      body: 'password=sesame',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      redirect: 'manual',
    });
    expect(right.status).toBe(303);
    const cookie = right.headers.get('set-cookie')!;
    expect(cookie).toMatch(/HttpOnly/);
    expect(cookie).toMatch(/SameSite=Lax/);
    const session = cookie.split(';')[0]!;
    const inside = await fetch(url + '/', { headers: { cookie: session } });
    expect(inside.status).toBe(200);
    await fetch(url + '/api/logout', { headers: { cookie: session }, redirect: 'manual' });
    expect((await fetch(url + '/', { headers: { cookie: session } })).status).toBe(401);
  });

  it('slows down guessing', async () => {
    const url = await listen(createApp(config({ password: 'sesame' })).server);
    let last = 0;
    for (let i = 0; i < 10; i++)
      last = (
        await fetch(url + '/api/login', {
          method: 'POST',
          body: `password=x${i}`,
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        })
      ).status;
    expect(last).toBe(429);
  });
});
