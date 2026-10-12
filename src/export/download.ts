import { saveFile } from '../platform';

/** Saves a blob: a download in the browser, a native Save dialog in the desktop app. */
export function downloadBlob(blob: Blob, filename: string): void {
  void saveFile(filename, blob, blob.type || 'application/octet-stream');
}

export const safeFileName = (name: string, fallback = 'home'): string =>
  (
    name
      .trim()
      .replace(/[^\p{L}\p{N}._ -]+/gu, '')
      .replace(/\s+/g, '_') || fallback
  ).slice(0, 60);
