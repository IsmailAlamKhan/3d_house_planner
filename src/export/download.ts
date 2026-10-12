/** Saves a blob through a temporary link (works for every browser; no server involved). */
export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

export const safeFileName = (name: string, fallback = 'home'): string =>
  (
    name
      .trim()
      .replace(/[^\p{L}\p{N}._ -]+/gu, '')
      .replace(/\s+/g, '_') || fallback
  ).slice(0, 60);
