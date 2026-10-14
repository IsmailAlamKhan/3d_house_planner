/** Style reference pictures for Enhance v2: the reference villa picture that ships with the app, or a file the user picks. */

/** Where the reference villa picture is served from (public/reference). */
export const REFERENCE_PICTURE_URL = '/reference/villa-reference.png';

const MAX_SIDE = 1024;

async function downscale(blob: Blob): Promise<string> {
  const bmp = await createImageBitmap(blob);
  const scale = Math.min(1, MAX_SIDE / Math.max(bmp.width, bmp.height));
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.round(bmp.width * scale));
  c.height = Math.max(1, Math.round(bmp.height * scale));
  c.getContext('2d')!.drawImage(bmp, 0, 0, c.width, c.height);
  return c.toDataURL('image/png');
}

/** The reference villa picture as a PNG data URL (at most 1024 pixels on the long side). */
export async function referenceStyle(): Promise<string> {
  const r = await fetch(REFERENCE_PICTURE_URL);
  if (!r.ok || !(r.headers.get('content-type') ?? '').startsWith('image/'))
    throw new Error('The reference picture is not available.');
  return downscale(await r.blob());
}

/** A picture the user chose, as a PNG data URL (at most 1024 pixels on the long side). */
export const fileStyle = (file: File): Promise<string> => downscale(file);

/** Is this the reference villa (its style reference defaults to the reference picture)? */
export const isReferenceProject = (p: { id: string; name: string }): boolean =>
  p.id.startsWith('ref-') || /reference villa/i.test(p.name);
