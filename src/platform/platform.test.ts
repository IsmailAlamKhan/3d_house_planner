import { afterEach, describe, expect, it, vi } from 'vitest';

const save = vi.fn(async () => '/tmp/home.glb');
const open = vi.fn(async () => '/tmp/project.json');
const writeFile = vi.fn(async () => undefined);
const writeTextFile = vi.fn(async () => undefined);
const readTextFile = vi.fn(async () => '{"a":1}');
vi.mock('@tauri-apps/plugin-dialog', () => ({ save, open }));
vi.mock('@tauri-apps/plugin-fs', () => ({ writeFile, writeTextFile, readTextFile }));

afterEach(() => {
  delete (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__;
  vi.clearAllMocks();
});

describe('platform adapter', () => {
  it('uses plain browser downloads when not in Tauri', async () => {
    const { isTauri, saveFile } = await import('./index');
    expect(isTauri()).toBe(false);
    const click = vi.fn();
    const orig = document.createElement.bind(document);
    vi.spyOn(document, 'createElement').mockImplementation((tag: string) => {
      const el = orig(tag);
      if (tag === 'a') el.click = click;
      return el;
    });
    URL.createObjectURL = vi.fn(() => 'blob:x');
    URL.revokeObjectURL = vi.fn();
    await saveFile('a.txt', 'hello', 'text/plain');
    expect(click).toHaveBeenCalled();
    expect(save).not.toHaveBeenCalled();
    vi.restoreAllMocks();
  });

  it('uses the native Save and Open dialogs in Tauri', async () => {
    (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__ = {};
    const { isTauri, saveFile, pickTextFile } = await import('./index');
    expect(isTauri()).toBe(true);
    expect(await saveFile('home.glb', new Blob([new Uint8Array([1, 2, 3])]))).toBe(true);
    expect(save).toHaveBeenCalledWith(expect.objectContaining({ defaultPath: 'home.glb' }));
    expect(writeFile).toHaveBeenCalledWith('/tmp/home.glb', expect.any(Uint8Array));
    await saveFile('notes.json', '{"x":1}');
    expect(writeTextFile).toHaveBeenCalledWith('/tmp/home.glb', '{"x":1}');
    const f = await pickTextFile();
    expect(f).toEqual({ name: 'project.json', text: '{"a":1}' });
    save.mockResolvedValueOnce(null as never);
    expect(await saveFile('x.json', 'y')).toBe(false);
  });
});
