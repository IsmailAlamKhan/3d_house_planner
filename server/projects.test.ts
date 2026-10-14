// @vitest-environment node
import { mkdtempSync } from 'node:fs';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createSampleProject } from '../src/model/sample';
import { createApp } from './app';
import { backupDatabase, restoreDatabase } from './backup';
import { MAX_VERSIONS, ProjectStore, VERSION_GAP_MS } from './store';

const servers: Server[] = [];
afterEach(() => servers.splice(0).forEach((s) => s.close()));

const sample = createSampleProject();
const withName = (name: string, extra: object = {}) => ({
  ...sample,
  name,
  updatedAt: new Date().toISOString(),
  ...extra,
});

describe('ProjectStore', () => {
  it('creates, reads, lists and updates with revisions', () => {
    const s = new ProjectStore(':memory:');
    expect(s.create(sample)).toEqual({ id: sample.id, revision: 1 });
    expect(s.create(sample)).toBe('exists');
    expect(s.list()).toMatchObject([{ id: sample.id, name: sample.name, revision: 1 }]);
    expect(s.get(sample.id)!.revision).toBe(1);
    const r = s.update(sample.id, 1, withName('Renamed'));
    expect(r).toEqual({ ok: true, revision: 2 });
    expect(s.get(sample.id)!.project.name).toBe('Renamed');
    expect(s.get('nope')).toBeNull();
    expect(s.update('nope', 1, sample)).toBe('missing');
  });

  it('refuses a stale update (two devices) and returns the server copy', () => {
    const s = new ProjectStore(':memory:');
    s.create(sample);
    s.update(sample.id, 1, withName('Device A'));
    const r = s.update(sample.id, 1, withName('Device B'));
    expect(r).toMatchObject({ ok: false, conflict: { revision: 2 } });
    expect((r as { conflict: { project: { name: string } } }).conflict.project.name).toBe(
      'Device A',
    );
    expect(s.get(sample.id)!.project.name).toBe('Device A'); // nothing was overwritten
  });

  it('rejects data that is not a valid project', () => {
    const s = new ProjectStore(':memory:');
    expect(() => s.create({ ...sample, walls: 5 })).toThrow();
    s.create(sample);
    expect(() => s.update(sample.id, 1, { nonsense: true })).toThrow();
  });

  it('keeps the last 20 versions and can restore one as a new revision', () => {
    const s = new ProjectStore(':memory:');
    s.create(sample);
    let t = Date.now();
    for (let i = 1; i <= 30; i++) {
      t += VERSION_GAP_MS + 1000;
      s.update(sample.id, i, withName(`v${i}`), t);
    }
    const versions = s.versions(sample.id);
    expect(versions).toHaveLength(MAX_VERSIONS);
    expect(versions[0]!.name).toBe('v30');
    const old = versions[5]!;
    const r = s.restore(sample.id, old.id)!;
    expect(r.revision).toBe(32);
    expect(s.get(sample.id)!.project.name).toBe(old.name);
    expect(s.restore(sample.id, 999999)).toBeNull();
    // Quick saves replace the newest version instead of adding one.
    const before = s.versions(sample.id).length;
    s.update(sample.id, 32, withName('quick1'), t + VERSION_GAP_MS * 10 + 10);
    s.update(sample.id, 33, withName('quick2'), t + VERSION_GAP_MS * 10 + 1000);
    expect(s.versions(sample.id).length).toBeLessThanOrEqual(before + 1);
  });

  it('deletes a project and its versions', () => {
    const s = new ProjectStore(':memory:');
    s.create(sample);
    expect(s.delete(sample.id)).toBe(true);
    expect(s.list()).toEqual([]);
    expect(s.versions(sample.id)).toEqual([]);
    expect(s.delete(sample.id)).toBe(false);
  });
});

async function app(over: Partial<{ password: string | null }> = {}, dataDir = ':memory:') {
  const a = createApp({
    port: 0,
    host: '127.0.0.1',
    ollamaUrl: 'http://127.0.0.1:9',
    comfyUrl: null,
    model: 'm',
    visionModel: 'v',
    password: over.password ?? null,
    distDir: 'dist',
    dataDir,
  });
  servers.push(a.server);
  const url = await new Promise<string>((ok) =>
    a.server.listen(0, '127.0.0.1', () =>
      ok(`http://127.0.0.1:${(a.server.address() as AddressInfo).port}`),
    ),
  );
  const call = (
    path: string,
    method = 'GET',
    body?: unknown,
    headers: Record<string, string> = {},
  ) =>
    fetch(url + path, {
      method,
      body: body === undefined ? undefined : JSON.stringify(body),
      headers,
    });
  return { a, url, call };
}

describe('/api/projects', () => {
  it('lets a second device see a project and detects simultaneous edits', async () => {
    const { call } = await app();
    expect((await call('/api/projects', 'POST', sample)).status).toBe(201);
    expect((await call('/api/projects', 'POST', sample)).status).toBe(409);
    const list = (await (await call('/api/projects')).json()) as { id: string; revision: number }[];
    expect(list.map((p) => p.id)).toEqual([sample.id]);
    // Device B downloads, then A saves, then B tries to save on the old revision.
    const got = (await (await call(`/api/projects/${sample.id}`)).json()) as {
      revision: number;
      project: unknown;
    };
    const a = await call(`/api/projects/${sample.id}`, 'PUT', {
      baseRevision: got.revision,
      project: withName('A'),
    });
    expect(a.status).toBe(200);
    const b = await call(`/api/projects/${sample.id}`, 'PUT', {
      baseRevision: got.revision,
      project: withName('B'),
    });
    expect(b.status).toBe(409);
    const body = (await b.json()) as { error: string; revision: number; project: { name: string } };
    expect(body).toMatchObject({ error: 'conflict', revision: 2 });
    expect(body.project.name).toBe('A');
  });

  it('validates writes, serves versions, restores and deletes', async () => {
    const { call } = await app();
    expect((await call('/api/projects', 'POST', { junk: 1 })).status).toBe(422);
    expect((await call('/api/projects', 'POST', sample)).status).toBe(201);
    expect((await call(`/api/projects/${sample.id}`, 'PUT', { project: sample })).status).toBe(400);
    const v = (await (await call(`/api/projects/${sample.id}/versions`)).json()) as {
      id: number;
    }[];
    expect(v.length).toBeGreaterThanOrEqual(1);
    expect(
      (await call(`/api/projects/${sample.id}/versions/${v[0]!.id}/restore`, 'POST')).status,
    ).toBe(200);
    expect((await call('/api/projects/nope')).status).toBe(404);
    expect((await call(`/api/projects/${sample.id}`, 'DELETE')).status).toBe(200);
    expect((await call(`/api/projects/${sample.id}`)).status).toBe(404);
  });

  it('needs the session cookie when a password is set', async () => {
    const { call, url } = await app({ password: 'pw' });
    expect((await call('/api/projects')).status).toBe(401);
    const login = await fetch(url + '/api/login', {
      method: 'POST',
      body: 'password=pw',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      redirect: 'manual',
    });
    const cookie = login.headers.get('set-cookie')!.split(';')[0]!;
    expect((await call('/api/projects', 'GET', undefined, { cookie })).status).toBe(200);
  });

  it('keeps projects across a restart (the database file persists)', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'dd-data-'));
    const first = await app({}, dir);
    await first.call('/api/projects', 'POST', sample);
    first.a.server.close();
    const second = await app({}, dir);
    const list = (await (await second.call('/api/projects')).json()) as { id: string }[];
    expect(list.map((p) => p.id)).toEqual([sample.id]);
  });
});

describe('backup and restore', () => {
  it('copies a live database consistently and restores it, even into a database that has changed since', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'dd-bak-'));
    const dbFile = join(dir, 'app.db');
    const live = new ProjectStore(dbFile);
    live.create(sample);
    live.update(sample.id, 1, withName('Before backup'));
    const backupFile = join(dir, 'backup.db');
    await backupDatabase(dbFile, backupFile); // while `live` still has the file open

    live.update(sample.id, 2, withName('After backup'));
    const other = createSampleProject();
    live.create({ ...other, id: 'second-project', name: 'Second' });
    expect(live.list()).toHaveLength(2);

    const r = restoreDatabase(dbFile, backupFile);
    expect(r.projects).toBe(1);
    // The running store sees the restored state.
    expect(live.list().map((p) => p.name)).toEqual(['Before backup']);
    expect(live.get(sample.id)!.revision).toBe(2);
    live.close();
    // And so does a fresh start from the same file.
    const again = new ProjectStore(dbFile);
    expect(again.get(sample.id)!.project.name).toBe('Before backup');
    again.close();
  });
});
