import { afterEach, describe, expect, it, vi } from 'vitest';
import { getEntry } from '../catalog';
import { hasPackTexture } from './textures';
import { packActive, usePack } from './pack';

const index = {
  version: 1,
  generated: '2026-01-01',
  models: [
    {
      id: 'kn-wc',
      catalogId: 'wc',
      file: 'models/kn-wc.glb',
      size: { w: 0.4, d: 0.7, h: 0.75 },
      recolor: [],
      lod: 0,
    },
  ],
  textures: [
    {
      id: 'acg-test',
      materialId: 'floor-marble',
      scale: 1.2,
      albedo: 'textures/acg-test/albedo.webp',
    },
  ],
  hdris: [],
};

const json = (body: unknown) =>
  new Response(JSON.stringify(body), { headers: { 'content-type': 'application/json' } });

afterEach(() => {
  usePack.getState().setEnabled(true);
  vi.unstubAllGlobals();
});

describe('asset pack at run time', () => {
  it('without a pack nothing changes and nothing throws (offline, static hosting)', async () => {
    vi.stubGlobal('fetch', () =>
      Promise.resolve(new Response('<html></html>', { headers: { 'content-type': 'text/html' } })),
    );
    const before = getEntry('wc')!.build3D;
    await usePack.getState().load();
    expect(usePack.getState().status).toBe('none');
    expect(packActive()).toBe(false);
    expect(getEntry('wc')!.build3D).toBe(before);
    expect(hasPackTexture('floor-marble')).toBe(false);
  });

  it('a pack whose model file is missing keeps the procedural model; switching it off restores everything', async () => {
    vi.stubGlobal('fetch', (url: string) =>
      Promise.resolve(
        url.endsWith('pack.json') ? json(index) : new Response('nope', { status: 404 }),
      ),
    );
    const entry = getEntry('wc')!;
    const before = entry.build3D;
    await usePack.getState().load();
    expect(packActive()).toBe(true);
    expect(entry.build3D).not.toBe(before);
    expect(hasPackTexture('floor-marble')).toBe(true);

    const model = entry.build3D({}, entry.defaultSize);
    expect(model.children.length).toBeGreaterThan(0); // the procedural toilet, not an empty group

    usePack.getState().setEnabled(false);
    expect(packActive()).toBe(false);
    expect(entry.build3D).toBe(before);
    expect(hasPackTexture('floor-marble')).toBe(false);
  });

  it('a pack file that does not match the schema is ignored', async () => {
    vi.stubGlobal('fetch', () => Promise.resolve(json({ version: 2 })));
    await usePack.getState().load();
    expect(usePack.getState().status).toBe('none');
  });
});
