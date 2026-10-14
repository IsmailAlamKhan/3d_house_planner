import type { StudioHealth, StudioJobInfo, StudioQuality, StudioResultMeta } from './protocol';

/** Thin wrappers over the app server's /api/studio routes. */

export class StudioApiError extends Error {
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
    throw new StudioApiError(body.error ?? `Server error ${res.status}`, res.status, body.code);
  return body as T;
}

/** Is Blender configured and does Cycles have a GPU? Static hosting (no app server) reports "not configured". */
export async function fetchStudioHealth(): Promise<StudioHealth> {
  try {
    const res = await fetch('/api/health', { signal: AbortSignal.timeout(90_000) });
    if (!res.ok) return { configured: false, ready: false };
    const j = (await res.json()) as { studio?: StudioHealth };
    return j.studio ?? { configured: false, ready: false };
  } catch {
    return { configured: false, ready: false };
  }
}

export const submitStudio = (body: Blob, quality: StudioQuality): Promise<{ id: string }> =>
  fetch(`/api/studio/render?quality=${quality}`, { method: 'POST', body }).then((r) => json(r));

export const getStudioJob = (id: string): Promise<StudioJobInfo> =>
  fetch(`/api/studio/jobs/${id}`).then((r) => json<StudioJobInfo>(r));

export const cancelStudioJob = (id: string): Promise<StudioJobInfo> =>
  fetch(`/api/studio/jobs/${id}`, { method: 'DELETE' }).then((r) => json<StudioJobInfo>(r));

export const listStudioResults = async (projectId: string): Promise<StudioResultMeta[]> => {
  const r = await fetch(`/api/studio/results?project=${encodeURIComponent(projectId)}`);
  // Static hosting answers every URL with the app page: that is "no results", not a list.
  const j: unknown = await json<unknown>(r).catch(() => []);
  return Array.isArray(j) ? (j as StudioResultMeta[]) : [];
};

export const studioPictureUrl = (id: string): string => `/api/studio/results/${id}`;

export const deleteStudioResult = (id: string): Promise<unknown> =>
  fetch(`/api/studio/results/${id}`, { method: 'DELETE' }).then((r) => json(r));

/** Polls a job every second until it is done, failed or cancelled. */
export async function waitForStudioJob(
  id: string,
  onUpdate: (j: StudioJobInfo) => void,
  signal: AbortSignal,
  intervalMs = 1000,
): Promise<StudioJobInfo> {
  for (;;) {
    if (signal.aborted) throw new StudioApiError('Cancelled', 499);
    const j = await getStudioJob(id);
    onUpdate(j);
    if (j.status === 'done' || j.status === 'error' || j.status === 'cancelled') return j;
    await new Promise((r) => setTimeout(r, intervalMs));
  }
}
