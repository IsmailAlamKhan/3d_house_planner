// @vitest-environment node
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';
import { createSampleProject } from '../src/model/sample';
import { getMeta, SyncClient } from '../src/persistence/sync';
import { listProjects, loadStoredProject, saveProject } from '../src/persistence/repo';
import { createMemoryBackend } from '../src/persistence/storage';
import { createApp } from './app';

const servers: Server[] = [];
afterEach(() => servers.splice(0).forEach((s) => s.close()));

async function setup() {
  const a = createApp({
    port: 0,
    host: '127.0.0.1',
    ollamaUrl: 'http://127.0.0.1:9',
    comfyUrl: null,
    model: 'm',
    password: null,
    distDir: 'dist',
    dataDir: ':memory:',
  });
  servers.push(a.server);
  const url = await new Promise<string>((ok) =>
    a.server.listen(0, '127.0.0.1', () =>
      ok(`http://127.0.0.1:${(a.server.address() as AddressInfo).port}`),
    ),
  );
  const device = () => {
    const backend = createMemoryBackend();
    let online = true;
    const http: typeof fetch = async (path, init) => {
      if (!online) throw new TypeError('network down');
      return fetch(url + String(path), init);
    };
    return {
      backend,
      client: new SyncClient(http, backend),
      setOnline: (v: boolean) => (online = v),
    };
  };
  return { device, url };
}

// A project someone has actually worked on (the untouched starter sample is deliberately not uploaded).
const base = { ...createSampleProject(), updatedAt: '2030-01-01T00:00:00.000Z' };
const edited = (name: string) => ({ ...base, name, updatedAt: new Date().toISOString() });

describe('sync between devices', () => {
  it('a project made on one device shows up on another', async () => {
    const { device } = await setup();
    const phone = device();
    const laptop = device();
    await saveProject(base, phone.backend);
    expect(await phone.client.available()).toBe(true);
    await phone.client.pull(); // uploads the local-only project
    expect((await getMeta(base.id, phone.backend))!.revision).toBe(1);

    await laptop.client.pull();
    expect((await listProjects(laptop.backend)).map((p) => p.id)).toEqual([base.id]);
    expect((await loadStoredProject(base.id, laptop.backend))!.name).toBe(base.name);
  });

  it('simultaneous edits give a conflict instead of overwriting; each choice works', async () => {
    const { device } = await setup();
    const a = device();
    const b = device();
    await saveProject(base, a.backend);
    await a.client.pull();
    await b.client.pull();

    expect((await a.client.push(edited('A edits'))).kind).toBe('ok');
    const stale = await b.client.push(edited('B edits'));
    expect(stale.kind).toBe('conflict');
    if (stale.kind !== 'conflict') return;
    expect(stale.project.name).toBe('A edits');

    // Save as a copy: B keeps its work as a new project and gets A's version of the original.
    const copy = await b.client.saveAsCopy(edited('B edits'), {
      revision: stale.revision,
      project: stale.project,
    });
    expect(copy.id).not.toBe(base.id);
    expect(copy.name).toBe('B edits (copy)');
    expect((await loadStoredProject(base.id, b.backend))!.name).toBe('A edits');
    await a.client.pull();
    expect((await listProjects(a.backend)).map((p) => p.id).sort()).toEqual(
      [base.id, copy.id].sort(),
    );

    // Overwrite: A decides its version wins.
    const c = device();
    await c.client.pull();
    await a.client.push(edited('A again'));
    const clash = await c.client.push(edited('C edits'));
    expect(clash.kind).toBe('conflict');
    if (clash.kind === 'conflict')
      expect((await c.client.overwrite(edited('C edits'), clash.revision)).kind).toBe('ok');
    const final = await device().client.fetchOne(base.id);
    expect(final!.project.name).toBe('C edits');
  });

  it('edits made offline are marked dirty and sync when the server is back', async () => {
    const { device } = await setup();
    const d = device();
    await saveProject(base, d.backend);
    await d.client.pull();
    d.setOnline(false);
    expect(await d.client.available()).toBe(false);
    expect((await d.client.push(edited('Offline edit'))).kind).toBe('offline');
    expect((await getMeta(base.id, d.backend))!.dirty).toBe(true);
    await saveProject(edited('Offline edit'), d.backend);
    d.setOnline(true);
    const results = await d.client.flushDirty();
    expect(results.map((r) => r.kind)).toEqual(['ok']);
    expect((await getMeta(base.id, d.backend))!.dirty).toBe(false);
    expect((await device().client.fetchOne(base.id))!.project.name).toBe('Offline edit');
  });

  it('a project deleted on one device disappears from the others', async () => {
    const { device } = await setup();
    const a = device();
    const b = device();
    await saveProject(base, a.backend);
    await a.client.pull();
    await b.client.pull();
    await a.client.remove(base.id);
    await b.client.pull();
    expect(await listProjects(b.backend)).toEqual([]);
  });

  it('knows when there is no app server (static hosting)', async () => {
    const c = new SyncClient(
      async () => new Response('<html></html>', { status: 200 }),
      createMemoryBackend(),
    );
    expect(await c.available()).toBe(false);
  });
});
