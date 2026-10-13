/** Saving a file from the browser: a hidden download link with a suggested file name. */

/** Saves bytes or text under a suggested file name (a download in the browser). */
export async function saveFile(
  suggestedName: string,
  data: Blob | string | Uint8Array,
  mime = 'application/octet-stream',
): Promise<boolean> {
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
