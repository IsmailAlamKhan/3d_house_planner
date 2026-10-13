import { randomBytes } from 'node:crypto';
import {
  createReadStream,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/**
 * `/api/assets`: the user's own 3D models (.glb) and texture images, kept in `<data>/assets` and shared by every
 * device that uses this server.
 *
 *   GET    /api/assets           → { assets: AssetMeta[] }
 *   POST   /api/assets           the file as the body, its description (JSON, URL-encoded) in `X-Asset-Meta` → 201 AssetMeta
 *   GET    /api/assets/:id/file  the file (cached forever: an id never changes its content)
 *   DELETE /api/assets/:id
 */

import type { AssetKind, AssetMeta } from '../src/custom/protocol';

export type { AssetKind, AssetMeta };

export const MAX_MODEL = 60 * 1024 * 1024;
export const MAX_TEXTURE = 20 * 1024 * 1024;
const ID = /^[a-f0-9]{16}$/;
const CATEGORIES = [
  'living',
  'dining',
  'bedroom',
  'kitchen',
  'bathroom',
  'outdoor',
  'decor',
  'other',
  'custom',
];
const MIME: Record<string, string> = {
  glb: 'model/gltf-binary',
  png: 'image/png',
  jpg: 'image/jpeg',
  webp: 'image/webp',
};

function send(res: ServerResponse, status: number, body: unknown): void {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Cache-Control', 'no-store');
  res.end(JSON.stringify(body));
}

function readBytes(req: IncomingMessage, max: number): Promise<Buffer> {
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
        ? reject(Object.assign(new Error('File too large'), { status: 413 }))
        : resolve(Buffer.concat(chunks)),
    );
    req.on('error', reject);
  });
}

/** What the bytes really are (never trust the file name): a binary glTF 2 model or a PNG / JPEG / WebP image. */
export function sniff(buf: Buffer): { kind: AssetKind; ext: string } | null {
  if (buf.length < 16) return null;
  if (buf.subarray(0, 4).toString('latin1') === 'glTF' && buf.readUInt32LE(4) === 2)
    return { kind: 'model', ext: 'glb' };
  if (buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])))
    return { kind: 'texture', ext: 'png' };
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return { kind: 'texture', ext: 'jpg' };
  if (
    buf.subarray(0, 4).toString('latin1') === 'RIFF' &&
    buf.subarray(8, 12).toString('latin1') === 'WEBP'
  )
    return { kind: 'texture', ext: 'webp' };
  return null;
}

const num = (v: unknown, min: number, max: number): number | null => {
  const n = Number(v);
  return Number.isFinite(n) && n >= min && n <= max ? n : null;
};

/** Checks the description a client sent; returns the clean fields or an error message. */
export function parseMeta(
  raw: string | undefined,
  kind: AssetKind,
): { name: string; model?: AssetMeta['model']; texture?: AssetMeta['texture'] } | string {
  let j: Record<string, unknown>;
  try {
    j = JSON.parse(decodeURIComponent(raw ?? '')) as Record<string, unknown>;
  } catch {
    return 'The X-Asset-Meta header must be URL-encoded JSON.';
  }
  // No control characters or angle brackets in names (they are shown in the interface).
  const name = [...String(j.name ?? '')]
    .filter((ch) => ch.charCodeAt(0) >= 32 && ch !== '<' && ch !== '>')
    .join('')
    .trim()
    .slice(0, 60);
  if (!name) return 'Give it a name.';
  if (kind === 'texture') {
    const scale = num(j.scale, 0.05, 20);
    return scale === null
      ? 'The texture size must be between 0.05 and 20 metres.'
      : { name, texture: { scale } };
  }
  const w = num(j.w, 0.02, 30);
  const d = num(j.d, 0.02, 30);
  const h = num(j.h, 0.02, 30);
  if (w === null || d === null || h === null) return 'The size must be between 2 cm and 30 m.';
  const category = CATEGORIES.includes(String(j.category)) ? String(j.category) : 'custom';
  const placement = j.placement === 'wall-mounted' ? 'wall-mounted' : 'floor';
  const mount = num(j.mountHeight, 0, 5);
  return {
    name,
    model: { category, placement, w, d, h, ...(mount === null ? {} : { mountHeight: mount }) },
  };
}

export function createAssetService(opts: { dataDir: string }) {
  const root = join(
    !opts.dataDir || opts.dataDir === ':memory:'
      ? mkdtempSync(join(tmpdir(), 'dd-assets-'))
      : opts.dataDir,
    'assets',
  );
  mkdirSync(root, { recursive: true });
  const indexFile = join(root, 'index.json');
  const read = (): AssetMeta[] => {
    try {
      return JSON.parse(readFileSync(indexFile, 'utf8')) as AssetMeta[];
    } catch {
      return [];
    }
  };
  const write = (list: AssetMeta[]) => {
    const tmp = `${indexFile}.tmp`;
    writeFileSync(tmp, JSON.stringify(list));
    renameSync(tmp, indexFile);
  };
  const fileOf = (a: Pick<AssetMeta, 'id' | 'ext'>) => join(root, `${a.id}.${a.ext}`);

  /** Handles the request when it belongs to `/api/assets`; returns false otherwise. */
  async function handle(req: IncomingMessage, res: ServerResponse, path: string): Promise<boolean> {
    if (path !== '/api/assets' && !path.startsWith('/api/assets/')) return false;
    try {
      if (path === '/api/assets') {
        if (req.method === 'GET') {
          send(res, 200, { assets: read() });
          return true;
        }
        if (req.method === 'POST') {
          const buf = await readBytes(req, MAX_MODEL);
          const found = sniff(buf);
          if (!found) {
            send(res, 415, {
              error: 'Use a binary glTF model (.glb) or a PNG, JPEG or WebP image.',
            });
            return true;
          }
          if (found.kind === 'texture' && buf.length > MAX_TEXTURE) {
            send(res, 413, { error: 'Texture images may be up to 20 MB.' });
            return true;
          }
          const header = req.headers['x-asset-meta'];
          const meta = parseMeta(Array.isArray(header) ? header[0] : header, found.kind);
          if (typeof meta === 'string') {
            send(res, 400, { error: meta });
            return true;
          }
          const asset: AssetMeta = {
            id: randomBytes(8).toString('hex'),
            kind: found.kind,
            name: meta.name,
            ext: found.ext,
            size: buf.length,
            createdAt: new Date().toISOString(),
            ...(meta.model ? { model: meta.model } : {}),
            ...(meta.texture ? { texture: meta.texture } : {}),
          };
          writeFileSync(fileOf(asset), buf);
          write([...read(), asset]);
          send(res, 201, asset);
          return true;
        }
        send(res, 405, { error: 'Use GET or POST' });
        return true;
      }
      const m = /^\/api\/assets\/([a-f0-9]{16})(\/file)?$/.exec(path);
      if (!m || !ID.test(m[1]!)) {
        send(res, 404, { error: 'No such asset' });
        return true;
      }
      const asset = read().find((a) => a.id === m[1]);
      if (!asset) {
        send(res, 404, { error: 'No such asset' });
        return true;
      }
      if (m[2] && (req.method === 'GET' || req.method === 'HEAD')) {
        const file = fileOf(asset);
        if (!existsSync(file)) {
          send(res, 404, { error: 'The file is missing' });
          return true;
        }
        res.statusCode = 200;
        res.setHeader('Content-Type', MIME[asset.ext] ?? 'application/octet-stream');
        res.setHeader('Content-Length', String(statSync(file).size));
        res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
        if (req.method === 'HEAD') res.end();
        else createReadStream(file).pipe(res);
        return true;
      }
      if (!m[2] && req.method === 'DELETE') {
        write(read().filter((a) => a.id !== asset.id));
        rmSync(fileOf(asset), { force: true });
        send(res, 200, { ok: true });
        return true;
      }
      send(res, 405, { error: 'Method not allowed' });
      return true;
    } catch (e) {
      const status = (e as { status?: number }).status ?? 500;
      send(res, status, { error: status === 413 ? 'The file is too large.' : 'Server error' });
      return true;
    }
  }

  return { handle };
}
