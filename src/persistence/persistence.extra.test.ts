import { describe, expect, it } from 'vitest';
import { createSampleProject } from '../model/sample';
import { importProjectJson } from '../model/io';
import { setLanguage } from '../i18n';
import { MAX_SNAPSHOTS, MIN_GAP_MS, listSnapshots, loadSnapshot, saveSnapshot } from './history';
import { startAutosave, hasUnsavedChanges } from './autosave';
import { createMemoryBackend } from './storage';
import { loadStoredProject } from './repo';
import { create } from 'zustand';

const base = createSampleProject();

describe('version history', () => {
  it('keeps at most 20 versions, newest first; quick saves replace the newest one', async () => {
    const b = createMemoryBackend();
    const t0 = Date.parse('2026-01-01T00:00:00Z');
    for (let i = 0; i < 30; i++)
      await saveSnapshot({ ...base, name: `v${i}` }, b, t0 + i * (MIN_GAP_MS + 1000));
    const list = await listSnapshots(base.id, b);
    expect(list).toHaveLength(MAX_SNAPSHOTS);
    expect(list[0]!.name).toBe('v29');
    expect(list.at(-1)!.name).toBe('v10');
    // Two saves within the gap: one version.
    const c = createMemoryBackend();
    await saveSnapshot({ ...base, name: 'a' }, c, t0);
    await saveSnapshot({ ...base, name: 'b' }, c, t0 + 1000);
    expect((await listSnapshots(base.id, c)).map((s) => s.name)).toEqual(['b']);
    await saveSnapshot({ ...base, name: 'forced' }, c, t0 + 2000, true);
    expect((await listSnapshots(base.id, c)).map((s) => s.name)).toEqual(['forced', 'b']);
  });

  it('restores an earlier version exactly', async () => {
    const b = createMemoryBackend();
    await saveSnapshot(base, b, 1000);
    await saveSnapshot({ ...base, walls: base.walls.slice(1) }, b, 1000 + MIN_GAP_MS + 1);
    const list = await listSnapshots(base.id, b);
    expect(list).toHaveLength(2);
    const old = await loadSnapshot(base.id, list[1]!.index, b);
    expect(old!.walls).toEqual(base.walls);
    expect(await loadSnapshot(base.id, 99, b)).toBeNull();
  });
});

describe('autosave', () => {
  it('writes the project and a version, and reports unsaved work while a save is pending', async () => {
    const b = createMemoryBackend();
    const store = create<{ project: typeof base }>(() => ({ project: base }));
    const stop = startAutosave(store as never, b, 10);
    store.setState({ project: { ...base, name: 'Changed' } });
    expect(hasUnsavedChanges()).toBe(true);
    await new Promise((r) => setTimeout(r, 60));
    expect(hasUnsavedChanges()).toBe(false);
    expect((await loadStoredProject(base.id, b))!.name).toBe('Changed');
    expect((await listSnapshots(base.id, b))[0]!.name).toBe('Changed');
    stop();
  });
});

describe('damaged files', () => {
  it('give a readable message in both languages', () => {
    const msg = (text: string) => {
      try {
        importProjectJson(text);
      } catch (e) {
        return (e as Error).message;
      }
      return '';
    };
    expect(msg('{ not json')).toMatch(/not valid JSON/);
    expect(msg('42')).toMatch(/not a Duplex Designer project|Not a project/i);
    expect(msg(JSON.stringify({ ...base, walls: 5 }))).toMatch(/damaged or incomplete/);
    setLanguage('bn');
    expect(msg('{ not json')).toMatch(/JSON/);
    expect(msg('{ not json')).toMatch(/[ঀ-৿]/);
    setLanguage('en');
  });
});
