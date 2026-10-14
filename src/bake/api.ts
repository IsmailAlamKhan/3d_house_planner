import type { StudioJobInfo } from '../studio/protocol';
import type { BakeMeta, BakePreset, BakeQuality } from './protocol';

/** Thin wrappers over the app server's /api/bake routes. */

export class BakeApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code?: string,
  ) {
    super(message);
  }
}

async function json<T>(res: Response): Promise<T> {
  const body = (await res.json().catch(() => ({}))) as { error?: string; code?: string };
  if (!res.ok)
    throw new BakeApiError(body.error ?? `Server error ${res.status}`, res.status, body.code);
  return body as T;
}

export const submitBake = (
  body: Blob,
  o: { projectId: string; quality: BakeQuality; key: string },
): Promise<{ id: string }> =>
  fetch(`/api/bake?project=${encodeURIComponent(o.projectId)}&quality=${o.quality}&key=${o.key}`, {
    method: 'POST',
    body,
  }).then((r) => json(r));

export const getBakeJob = (id: string): Promise<StudioJobInfo> =>
  fetch(`/api/bake/jobs/${id}`).then((r) => json<StudioJobInfo>(r));

export const cancelBakeJob = (id: string): Promise<StudioJobInfo> =>
  fetch(`/api/bake/jobs/${id}`, { method: 'DELETE' }).then((r) => json<StudioJobInfo>(r));

/** The bakes of a project, one per lighting preset. Static hosting answers every URL with the app page: that is "none". */
export async function listBakes(projectId: string): Promise<BakeMeta[]> {
  try {
    const r = await fetch(`/api/bake/results?project=${encodeURIComponent(projectId)}`);
    const j: unknown = await json<unknown>(r);
    return Array.isArray(j) ? (j as BakeMeta[]) : [];
  } catch {
    return [];
  }
}

export const lightmapUrl = (projectId: string, preset: BakePreset, key: string): string =>
  `/api/bake/${encodeURIComponent(projectId)}/${preset}/lightmap?v=${key}`;

export async function fetchBakeUv(projectId: string, preset: BakePreset): Promise<Float32Array> {
  const r = await fetch(`/api/bake/${encodeURIComponent(projectId)}/${preset}/uv`);
  if (!r.ok) throw new BakeApiError('The lightmap UVs are missing.', r.status);
  return new Float32Array(await r.arrayBuffer());
}

export const deleteBake = (projectId: string, preset: BakePreset): Promise<unknown> =>
  fetch(`/api/bake/${encodeURIComponent(projectId)}/${preset}`, { method: 'DELETE' }).then((r) =>
    json(r),
  );

/** Polls a bake job every second until it is done, failed or cancelled. */
export async function waitForBakeJob(
  id: string,
  onUpdate: (j: StudioJobInfo) => void,
  signal: AbortSignal,
  intervalMs = 1000,
): Promise<StudioJobInfo> {
  for (;;) {
    if (signal.aborted) throw new BakeApiError('Cancelled', 499);
    const j = await getBakeJob(id);
    onUpdate(j);
    if (j.status === 'done' || j.status === 'error' || j.status === 'cancelled') return j;
    await new Promise((r) => setTimeout(r, intervalMs));
  }
}
