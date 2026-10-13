import type { AssetMeta } from './protocol';

/** The user's uploaded models and textures, kept on the app server (`/api/assets`). */

/** All assets, or `null` when this app has no server behind it (a static site, the dev server). */
export async function listAssets(): Promise<AssetMeta[] | null> {
  try {
    const r = await fetch('/api/assets', { cache: 'no-store' });
    if (!r.ok) return null;
    const j = (await r.json()) as { assets?: AssetMeta[] };
    return Array.isArray(j.assets) ? j.assets : null;
  } catch {
    return null;
  }
}

/** Uploads a file with its description. Throws an Error with a message fit for the user. */
export async function uploadAsset(file: Blob, meta: Record<string, unknown>): Promise<AssetMeta> {
  let r: Response;
  try {
    r = await fetch('/api/assets', {
      method: 'POST',
      headers: { 'X-Asset-Meta': encodeURIComponent(JSON.stringify(meta)) },
      body: file,
    });
  } catch {
    throw new Error('The app server could not be reached.');
  }
  const j = (await r.json().catch(() => ({}))) as AssetMeta & { error?: string };
  if (!r.ok) throw new Error(j.error ?? `The upload failed (${r.status}).`);
  return j;
}

export async function deleteAsset(id: string): Promise<void> {
  const r = await fetch(`/api/assets/${id}`, { method: 'DELETE' });
  if (!r.ok) throw new Error(`Could not delete it (${r.status}).`);
}
