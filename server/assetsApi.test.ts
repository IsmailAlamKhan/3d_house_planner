// @vitest-environment node
import { mkdtempSync } from 'node:fs';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createApp } from './app';
import { parseMeta, sniff } from './assetsApi';

const servers: Server[] = [];
afterEach(() => servers.splice(0).forEach((s) => s.close()));

async function start(password: string | null = null) {
  const handle = createApp({
    port: 0,
    host: '127.0.0.1',
    ollamaUrl: 'http://127.0.0.1:9',
    comfyUrl: null,
    model: 'qwen3:14b',
    password,
    distDir: mkdtempSync(join(tmpdir(), 'dd-dist-')),
    dataDir: ':memory:',
  });
  servers.push(handle.server);
  return new Promise<string>((resolve) =>
    handle.server.listen(0, '127.0.0.1', () =>
      resolve(`http://127.0.0.1:${(handle.server.address() as AddressInfo).port}`),
    ),
  );
}

/** The 12-byte binary glTF header plus a few bytes: enough for the server's content check. */
const GLB = Buffer.concat([
  Buffer.from('glTF', 'latin1'),
  Buffer.from([2, 0, 0, 0, 32, 0, 0, 0, 0, 0, 0, 0]),
  Buffer.alloc(20, 1),
]);
const PNG = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  Buffer.alloc(40, 3),
]);
const meta = (o: object) => encodeURIComponent(JSON.stringify(o));
const MODEL = {
  name: 'Velvet armchair',
  category: 'living',
  placement: 'floor',
  w: 0.9,
  d: 0.8,
  h: 0.85,
};

const upload = (url: string, body: Buffer, m: object | null) =>
  fetch(`${url}/api/assets`, {
    method: 'POST',
    headers: m ? { 'X-Asset-Meta': meta(m) } : {},
    body: new Uint8Array(body),
  });

describe('content check', () => {
  it('recognises models and images by their bytes, never by name', () => {
    expect(sniff(GLB)).toEqual({ kind: 'model', ext: 'glb' });
    expect(sniff(PNG)).toEqual({ kind: 'texture', ext: 'png' });
    expect(sniff(Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(20)]))).toEqual(
      {
        kind: 'texture',
        ext: 'jpg',
      },
    );
    expect(
      sniff(
        Buffer.concat([Buffer.from('RIFF'), Buffer.alloc(4), Buffer.from('WEBP'), Buffer.alloc(8)]),
      ),
    ).toEqual({ kind: 'texture', ext: 'webp' });
    expect(sniff(Buffer.from('<html>not a model at all, just text</html>'))).toBeNull();
    // glTF version 1 is not supported
    expect(
      sniff(Buffer.concat([Buffer.from('glTF'), Buffer.from([1, 0, 0, 0]), Buffer.alloc(20)])),
    ).toBeNull();
  });

  it('cleans and limits the description', () => {
    expect(parseMeta(meta({ name: '  <b>Lamp</b>\n', w: 1, d: 1, h: 1 }), 'model')).toMatchObject({
      name: 'bLamp/b',
    });
    expect(parseMeta(meta({ name: '', w: 1, d: 1, h: 1 }), 'model')).toBe('Give it a name.');
    expect(parseMeta(meta({ name: 'x', w: 0, d: 1, h: 1 }), 'model')).toMatch(/size/);
    expect(parseMeta(meta({ name: 'x', w: 1, d: 1, h: 99 }), 'model')).toMatch(/size/);
    expect(parseMeta(meta({ name: 'x', scale: 0 }), 'texture')).toMatch(/texture size/);
    expect(parseMeta('%%%', 'model')).toMatch(/URL-encoded/);
    expect(
      parseMeta(meta({ name: 'x', w: 1, d: 1, h: 1, category: 'weird' }), 'model'),
    ).toMatchObject({
      model: { category: 'custom', placement: 'floor' },
    });
  });
});

describe('/api/assets', () => {
  it('uploads, lists, serves and deletes a model', async () => {
    const url = await start();
    expect(await (await fetch(`${url}/api/assets`)).json()).toEqual({ assets: [] });

    const r = await upload(url, GLB, MODEL);
    expect(r.status).toBe(201);
    const a = (await r.json()) as {
      id: string;
      kind: string;
      ext: string;
      size: number;
      model: object;
    };
    expect(a).toMatchObject({
      kind: 'model',
      ext: 'glb',
      size: GLB.length,
      name: 'Velvet armchair',
    });
    expect(a.model).toMatchObject({ category: 'living', placement: 'floor', w: 0.9, h: 0.85 });

    const list = (await (await fetch(`${url}/api/assets`)).json()) as { assets: { id: string }[] };
    expect(list.assets.map((x) => x.id)).toEqual([a.id]);

    const file = await fetch(`${url}/api/assets/${a.id}/file`);
    expect(file.status).toBe(200);
    expect(file.headers.get('content-type')).toBe('model/gltf-binary');
    expect(file.headers.get('cache-control')).toContain('immutable');
    expect(Buffer.from(await file.arrayBuffer()).equals(GLB)).toBe(true);

    expect((await fetch(`${url}/api/assets/${a.id}`, { method: 'DELETE' })).status).toBe(200);
    expect((await fetch(`${url}/api/assets/${a.id}/file`)).status).toBe(404);
    expect(await (await fetch(`${url}/api/assets`)).json()).toEqual({ assets: [] });
  });

  it('stores a texture with its real-world size', async () => {
    const url = await start();
    const r = await upload(url, PNG, { name: 'Walnut parquet', scale: 0.6 });
    expect(r.status).toBe(201);
    const a = (await r.json()) as { id: string; kind: string; texture: { scale: number } };
    expect(a).toMatchObject({ kind: 'texture', texture: { scale: 0.6 } });
    const file = await fetch(`${url}/api/assets/${a.id}/file`);
    expect(file.headers.get('content-type')).toBe('image/png');
  });

  it('refuses what it cannot use, with a reason', async () => {
    const url = await start();
    const text = await upload(url, Buffer.from('this is not a model, it is only text'), MODEL);
    expect(text.status).toBe(415);
    expect(((await text.json()) as { error: string }).error).toMatch(/\.glb/);
    expect((await upload(url, GLB, null)).status).toBe(400);
    expect((await upload(url, GLB, { ...MODEL, name: '' })).status).toBe(400);
    expect((await upload(url, PNG, { name: 'x' })).status).toBe(400); // texture without a size
    expect((await fetch(`${url}/api/assets/not-an-id/file`)).status).toBe(404);
    expect((await fetch(`${url}/api/assets/0123456789abcdef/file`)).status).toBe(404);
    expect((await fetch(`${url}/api/assets/0123456789abcdef`, { method: 'DELETE' })).status).toBe(
      404,
    );
  });

  it('requires the password like every other API when one is set', async () => {
    const url = await start('secret');
    expect((await fetch(`${url}/api/assets`)).status).toBe(401);
    expect((await upload(url, GLB, MODEL)).status).toBe(401);
  });
});
