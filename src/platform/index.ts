/**
 * The few places where the desktop app (Tauri) and the browser differ: opening a project file and saving a file.
 * The browser path is a hidden file input and a download link; the desktop path uses the native dialogs.
 * Everything else in the app is identical, so the web version works unchanged without Tauri.
 */

export const isTauri = (): boolean =>
  typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;

export interface PickedFile {
  name: string;
  text: string;
}

/** Asks the user for a project file and returns its text, or null if they cancelled. */
export async function pickTextFile(extensions = ['json']): Promise<PickedFile | null> {
  if (isTauri()) {
    const { open } = await import('@tauri-apps/plugin-dialog');
    const { readTextFile } = await import('@tauri-apps/plugin-fs');
    const path = await open({ multiple: false, filters: [{ name: 'Project', extensions }] });
    if (typeof path !== 'string') return null;
    return { name: path.split(/[\\/]/).pop() ?? path, text: await readTextFile(path) };
  }
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = extensions.map((e) => `.${e}`).join(',');
    input.onchange = async () => {
      const f = input.files?.[0];
      resolve(f ? { name: f.name, text: await f.text() } : null);
    };
    input.oncancel = () => resolve(null);
    input.click();
  });
}

/** Saves bytes or text under a suggested file name (a download in the browser, a Save dialog on the desktop). */
export async function saveFile(
  suggestedName: string,
  data: Blob | string | Uint8Array,
  mime = 'application/octet-stream',
): Promise<boolean> {
  if (isTauri()) {
    const { save } = await import('@tauri-apps/plugin-dialog');
    const { writeFile, writeTextFile } = await import('@tauri-apps/plugin-fs');
    const ext = suggestedName.includes('.') ? suggestedName.split('.').pop()! : '';
    const path = await save({
      defaultPath: suggestedName,
      filters: ext ? [{ name: ext.toUpperCase(), extensions: [ext] }] : undefined,
    });
    if (!path) return false;
    if (typeof data === 'string') await writeTextFile(path, data);
    else
      await writeFile(path, data instanceof Blob ? new Uint8Array(await data.arrayBuffer()) : data);
    return true;
  }
  const blob = data instanceof Blob ? data : new Blob([data as BlobPart], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = suggestedName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
  return true;
}
