import { describe, expect, it, vi } from 'vitest';
import { createSampleProject } from '../model/sample';
import { useModel } from '../model/store';
import { startAutosave } from './autosave';
import {
  cloneProject,
  deleteProject,
  duplicateStoredProject,
  listProjects,
  loadStoredProject,
  renameStoredProject,
  saveProject,
} from './repo';
import { createMemoryBackend } from './storage';

describe('project repo', () => {
  it('saves, lists, renames, duplicates and deletes', async () => {
    const b = createMemoryBackend();
    const p = createSampleProject();
    await saveProject(p, b);
    expect(await loadStoredProject(p.id, b)).toEqual(p);
    await renameStoredProject(p.id, 'Renamed', b);
    expect((await listProjects(b))[0]!.name).toBe('Renamed');
    const copy = await duplicateStoredProject(p.id, b);
    expect(copy!.id).not.toBe(p.id);
    expect(await listProjects(b)).toHaveLength(2);
    await deleteProject(p.id, b);
    expect(await listProjects(b)).toHaveLength(1);
  });
  it('cloneProject gives a new id', () => {
    const p = createSampleProject();
    expect(cloneProject(p).id).not.toBe(p.id);
  });
});

describe('autosave', () => {
  it('debounces saves by 1 s', async () => {
    vi.useFakeTimers();
    const b = createMemoryBackend();
    const stop = startAutosave(useModel, b, 1000);
    const id = useModel.getState().project.id;
    useModel.getState().apply((p) => void (p.name = 'A'));
    useModel.getState().apply((p) => void (p.name = 'B'));
    await vi.advanceTimersByTimeAsync(500);
    expect(await loadStoredProject(id, b)).toBeNull();
    await vi.advanceTimersByTimeAsync(600);
    expect((await loadStoredProject(id, b))!.name).toBe('B');
    stop();
    vi.useRealTimers();
  });
});
