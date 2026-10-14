import { createReadStream, existsSync, readFileSync, statSync } from 'node:fs';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { extname, join, normalize, resolve, sep } from 'node:path';

const TYPES: Record<string, string> = {
  '.json': 'application/json',
  '.glb': 'model/gltf-binary',
  '.webp': 'image/webp',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.hdr': 'application/octet-stream',
};

/**
 * Serves the converted asset pack (`<assets>/pack`, built by `npm run assets:download`) under `/pack/`. Read-only, GET
 * and HEAD only, nothing outside the pack folder. Returns true when it handled the request (a missing file is a 404, so
 * the app can tell "no pack" from an HTML fallback page).
 */
export function createPackHandler(assetsDir: string) {
  const root = resolve(assetsDir, 'pack');
  return function handle(req: IncomingMessage, res: ServerResponse): boolean {
    const url = new URL(req.url ?? '/', 'http://x');
    if (!url.pathname.startsWith('/pack/')) return false;
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      res.statusCode = 405;
      res.end('Method not allowed');
      return true;
    }
    const file = normalize(join(root, decodeURIComponent(url.pathname.slice('/pack/'.length))));
    if (file !== root && !file.startsWith(root + sep)) {
      res.statusCode = 403;
      res.end('Forbidden');
      return true;
    }
    if (!existsSync(file) || !statSync(file).isFile()) {
      res.statusCode = 404;
      res.setHeader('Content-Type', 'text/plain');
      res.end('Not found');
      return true;
    }
    res.statusCode = 200;
    res.setHeader('Content-Type', TYPES[extname(file)] ?? 'application/octet-stream');
    // pack.json changes when the pack is rebuilt; the files are named by id and replaced rarely
    res.setHeader(
      'Cache-Control',
      file.endsWith('pack.json') ? 'no-cache' : 'public, max-age=86400',
    );
    if (req.method === 'HEAD') res.end();
    else createReadStream(file).pipe(res);
    return true;
  };
}

/** What the health check says about the pack: whether it is there and how many models it has. */
export function packStatus(assetsDir: string): { available: boolean; models: number } {
  try {
    const j = JSON.parse(readFileSync(join(resolve(assetsDir, 'pack'), 'pack.json'), 'utf8')) as {
      models?: unknown[];
    };
    return { available: true, models: j.models?.length ?? 0 };
  } catch {
    return { available: false, models: 0 };
  }
}
