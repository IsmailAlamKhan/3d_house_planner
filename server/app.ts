import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { createReadStream, existsSync, statSync } from 'node:fs';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { extname, join, normalize, resolve, sep } from 'node:path';
import { createAiProxy } from './aiProxy';
import { GpuQueue } from './gpuQueue';
import { ComfyClient } from './render/comfy';
import { createAssetService } from './assetsApi';
import { createRenderService, unloadOllama } from './render/renderApi';
import { createVisionService } from './vision/visionApi';
import { createPackHandler, packStatus } from './packStatic';
import { handleProjects } from './projectsApi';
import { ProjectStore } from './store';
import type { ServerConfig } from './config';

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.map': 'application/json',
  '.txt': 'text/plain; charset=utf-8',
};

const COOKIE = 'dd_session';
const SESSION_MS = 30 * 24 * 3600 * 1000;

const sha = (s: string) => createHash('sha256').update(s).digest();
const sameSecret = (a: string, b: string) => timingSafeEqual(sha(a), sha(b));

function json(res: ServerResponse, status: number, body: unknown): void {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Cache-Control', 'no-store');
  res.end(JSON.stringify(body));
}

function readForm(req: IncomingMessage): Promise<Record<string, string>> {
  return new Promise((ok, fail) => {
    let size = 0;
    const chunks: Buffer[] = [];
    req.on('data', (c: Buffer) => {
      size += c.length;
      if (size > 10_000) req.destroy();
      else chunks.push(c);
    });
    req.on('end', () => {
      const text = Buffer.concat(chunks).toString('utf8');
      try {
        ok(
          text.startsWith('{')
            ? (JSON.parse(text) as Record<string, string>)
            : Object.fromEntries(new URLSearchParams(text)),
        );
      } catch {
        ok({});
      }
    });
    req.on('error', fail);
  });
}

const LOGIN_PAGE = (error: boolean) => `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Duplex Designer — sign in</title>
<style>body{font-family:system-ui,sans-serif;background:#f1f5f9;color:#1e293b;display:grid;place-items:center;min-height:100vh;margin:0}
form{background:#fff;padding:2rem;border-radius:12px;box-shadow:0 4px 24px #0002;width:min(92vw,22rem)}
h1{font-size:1.2rem;margin:0 0 1rem}input{width:100%;box-sizing:border-box;padding:.6rem;font-size:1rem;border:1px solid #94a3b8;border-radius:6px}
button{margin-top:1rem;width:100%;padding:.6rem;font-size:1rem;border:0;border-radius:6px;background:#0369a1;color:#fff;cursor:pointer}
p{color:#b91c1c;margin:.5rem 0 0}</style></head>
<body><form method="post" action="/api/login"><h1>Duplex Designer</h1>
<label for="p">Password</label><input id="p" name="password" type="password" autofocus autocomplete="current-password" required>
${error ? '<p role="alert">That password is not right.</p>' : ''}
<button type="submit">Sign in</button></form></body></html>`;

export interface AppHandle {
  server: Server;
  store: ProjectStore;
  /** Active sessions (exposed for tests). */
  sessions: Map<string, number>;
}

/**
 * The production server: the built web app (with SPA fallback), `/api/ai` (local model proxy, one generation at a
 * time), `/api/health`, and an optional password (`APP_PASSWORD`) guarded by a session cookie.
 * Ollama itself stays on 127.0.0.1; only this server listens on the LAN.
 */
export function createApp(config: ServerConfig): AppHandle {
  // One GPU queue for language-model jobs and image-model jobs: they never run together, and each side unloads the
  // other's model (Ollama before a render, ComfyUI after one) so both fit on a 16 GB card.
  const comfy = config.comfyUrl ? new ComfyClient(config.comfyUrl) : null;
  const queue = new GpuQueue({
    beforeRender: () => unloadOllama(config.ollamaUrl),
    beforeSwitch: () => unloadOllama(config.ollamaUrl),
    afterRender: async () => void (await comfy?.free().catch(() => undefined)),
  });
  const ai = createAiProxy({ ollamaUrl: config.ollamaUrl, queue });
  const vision = createVisionService({
    ollamaUrl: config.ollamaUrl,
    model: config.visionModel,
    queue,
  });
  const pack = createPackHandler(config.assetsDir ?? 'assets');
  const render = createRenderService({ comfyUrl: config.comfyUrl, dataDir: config.dataDir, queue });
  const assets = createAssetService({ dataDir: config.dataDir });
  const store = new ProjectStore(
    config.dataDir === ':memory:' ? ':memory:' : join(config.dataDir, 'app.db'),
  );
  const sessions = new Map<string, number>();
  const attempts = new Map<string, { n: number; since: number }>();
  const root = resolve(config.distDir);

  const cookieOf = (req: IncomingMessage): string | null => {
    const m = new RegExp(`(?:^|;\\s*)${COOKIE}=([^;]+)`).exec(req.headers.cookie ?? '');
    return m ? m[1]! : null;
  };
  const signedIn = (req: IncomingMessage): boolean => {
    if (!config.password) return true;
    const t = cookieOf(req);
    const exp = t ? sessions.get(t) : undefined;
    if (!t || !exp) return false;
    if (exp < Date.now()) {
      sessions.delete(t);
      return false;
    }
    return true;
  };

  async function health(res: ServerResponse): Promise<void> {
    let ollama: { reachable: boolean; models: string[]; modelInstalled: boolean } = {
      reachable: false,
      models: [],
      modelInstalled: false,
    };
    try {
      const r = await fetch(`${config.ollamaUrl}/api/tags`, { signal: AbortSignal.timeout(2000) });
      const j = (await r.json()) as { models?: { name: string }[] };
      const models = (j.models ?? []).map((m) => m.name);
      ollama = {
        reachable: true,
        models,
        modelInstalled: models.some(
          (m) =>
            m === config.model ||
            m.startsWith(`${config.model}:`) ||
            config.model.startsWith(`${m}:`),
        ),
      };
    } catch {
      // Ollama is not running: the app still works with its offline generator.
    }
    const installed = (name: string) =>
      ollama.models.some((m) => m === name || m.startsWith(`${name}:`) || name.startsWith(`${m}:`));
    json(res, 200, {
      app: 'ok',
      model: config.model,
      vision: {
        model: config.visionModel,
        installed: ollama.reachable && installed(config.visionModel),
      },
      ollama,
      render: await render.health(),
      assets: packStatus(config.assetsDir ?? 'assets'),
      authRequired: !!config.password,
    });
  }

  function serveStatic(req: IncomingMessage, res: ServerResponse): void {
    const url = new URL(req.url ?? '/', 'http://x');
    let rel = decodeURIComponent(url.pathname);
    let file = normalize(join(root, rel));
    if (file !== root && !file.startsWith(root + sep)) {
      res.statusCode = 403;
      return void res.end('Forbidden');
    }
    const isFile = (p: string) => existsSync(p) && statSync(p).isFile();
    if (!isFile(file)) {
      // Real files that are missing are 404s; app routes fall back to the SPA.
      if (extname(rel) && rel !== '/') {
        res.statusCode = 404;
        return void res.end('Not found');
      }
      rel = '/index.html';
      file = join(root, rel);
    }
    if (!isFile(file)) {
      res.statusCode = 503;
      return void res.end('The app has not been built yet. Run: npm run build');
    }
    const ext = extname(file);
    res.statusCode = 200;
    res.setHeader('Content-Type', MIME[ext] ?? 'application/octet-stream');
    // Hashed assets never change; the shell and the service worker must always be revalidated.
    res.setHeader(
      'Cache-Control',
      file.includes(`${sep}assets${sep}`) ? 'public, max-age=31536000, immutable' : 'no-cache',
    );
    if (req.method === 'HEAD') return void res.end();
    createReadStream(file).pipe(res);
  }

  const server = createServer((req, res) => {
    void (async () => {
      const path = new URL(req.url ?? '/', 'http://x').pathname;

      if (path === '/api/health') return health(res); // public: it only says whether things are up

      if (path === '/api/login' && req.method === 'POST') {
        const ip = req.socket.remoteAddress ?? '?';
        const a = attempts.get(ip) ?? { n: 0, since: Date.now() };
        if (Date.now() - a.since > 60_000) Object.assign(a, { n: 0, since: Date.now() });
        if (a.n >= 8) return json(res, 429, { error: 'Too many attempts — wait a minute.' });
        const form = await readForm(req);
        if (config.password && sameSecret(String(form.password ?? ''), config.password)) {
          attempts.delete(ip);
          const token = randomBytes(24).toString('hex');
          sessions.set(token, Date.now() + SESSION_MS);
          res.setHeader(
            'Set-Cookie',
            `${COOKIE}=${token}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${SESSION_MS / 1000}`,
          );
          res.statusCode = 303;
          res.setHeader('Location', '/');
          return void res.end();
        }
        a.n++;
        attempts.set(ip, a);
        res.statusCode = 401;
        res.setHeader('Content-Type', 'text/html; charset=utf-8');
        return void res.end(LOGIN_PAGE(true));
      }
      if (path === '/api/logout') {
        const t = cookieOf(req);
        if (t) sessions.delete(t);
        res.setHeader('Set-Cookie', `${COOKIE}=; HttpOnly; Path=/; Max-Age=0`);
        res.statusCode = 303;
        res.setHeader('Location', '/');
        return void res.end();
      }

      if (!signedIn(req)) {
        if (path.startsWith('/api/')) return json(res, 401, { error: 'Sign in first.' });
        res.statusCode = 401;
        res.setHeader('Content-Type', 'text/html; charset=utf-8');
        return void res.end(LOGIN_PAGE(false));
      }

      if (pack(req, res)) return;
      if (path === '/api/ai') return ai(req, res);
      if (await vision.handle(req, res, path)) return;
      if (await render.handle(req, res, path)) return;
      if (await assets.handle(req, res, path)) return;
      if (await handleProjects(store, req, res, path)) return;
      if (path.startsWith('/api/')) return json(res, 404, { error: 'Unknown API route' });
      if (req.method !== 'GET' && req.method !== 'HEAD') {
        res.statusCode = 405;
        return void res.end('Method not allowed');
      }
      serveStatic(req, res);
    })().catch((e) => {
      console.error(e);
      if (!res.headersSent) json(res, 500, { error: 'Server error' });
      else res.end();
    });
  });
  server.on('close', () => store.close());
  return { server, store, sessions };
}
