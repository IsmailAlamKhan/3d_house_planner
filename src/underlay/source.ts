import { del, get, set } from 'idb-keyval';
import { nanoid } from 'nanoid';
import { assetFileUrl } from '../custom/protocol';
import { uploadAsset } from '../custom/api';
import type { Underlay } from '../model/types';

type Source = Underlay['source'];

const KEY = (k: string) => `duplex-designer:underlay:${k}`;

/** Resolves a relative URL against the app's base path (the app may be hosted in a sub-folder). */
function resolveUrl(url: string): string {
  if (/^([a-z]+:|\/)/i.test(url)) return url;
  const base = (import.meta.env?.BASE_URL as string | undefined) ?? '/';
  return `${base.endsWith('/') ? base : `${base}/`}${url}`;
}

/** The picture's bytes. Throws a readable error when it cannot be fetched. */
export async function underlayBlob(source: Source): Promise<Blob> {
  if (source.kind === 'local') {
    const b = await get<Blob>(KEY(source.key));
    if (!b) throw new Error('The picture is no longer stored in this browser.');
    return b;
  }
  const url = source.kind === 'asset' ? assetFileUrl(source.assetId) : resolveUrl(source.url);
  const r = await fetch(url);
  if (!r.ok) throw new Error(`The picture could not be loaded (${r.status}).`);
  return r.blob();
}

/** Decodes the picture. */
export async function loadUnderlayBitmap(source: Source): Promise<ImageBitmap> {
  const blob = await underlayBlob(source);
  try {
    return await createImageBitmap(blob);
  } catch {
    throw new Error('This file could not be read as a picture.');
  }
}

/** Reads a picture's pixel size without keeping it. */
export async function imageSize(file: Blob): Promise<{ width: number; height: number }> {
  let bmp: ImageBitmap;
  try {
    bmp = await createImageBitmap(file);
  } catch {
    throw new Error('This file could not be read as a picture. Use a PNG, JPEG or WebP.');
  }
  const size = { width: bmp.width, height: bmp.height };
  bmp.close();
  return size;
}

/**
 * Keeps a picture the user chose: on the app server (shared by every device) when there is one, otherwise in this
 * browser (static hosting). Returns where it went.
 */
export async function storeUnderlayImage(
  file: File | Blob,
  name: string,
  size: { width: number; height: number },
): Promise<Source> {
  try {
    const a = await uploadAsset(file, {
      as: 'image',
      name,
      width: size.width,
      height: size.height,
    });
    return { kind: 'asset', assetId: a.id };
  } catch {
    const key = nanoid(10);
    await set(KEY(key), file);
    return { kind: 'local', key };
  }
}

export async function forgetLocalImage(source: Source): Promise<void> {
  if (source.kind === 'local') await del(KEY(source.key));
}
