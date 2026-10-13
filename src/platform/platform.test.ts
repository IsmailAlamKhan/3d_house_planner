import { afterEach, describe, expect, it, vi } from 'vitest';

afterEach(() => {
  vi.restoreAllMocks();
});

describe('platform adapter', () => {
  it('saves through a plain browser download', async () => {
    const { saveFile } = await import('./index');
    const click = vi.fn();
    const orig = document.createElement.bind(document);
    vi.spyOn(document, 'createElement').mockImplementation((tag: string) => {
      const el = orig(tag);
      if (tag === 'a') el.click = click;
      return el;
    });
    URL.createObjectURL = vi.fn(() => 'blob:x');
    URL.revokeObjectURL = vi.fn();
    expect(await saveFile('a.txt', 'hello', 'text/plain')).toBe(true);
    expect(click).toHaveBeenCalled();
  });
});
