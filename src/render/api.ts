import { type EnhanceRequest, type JobInfo, type RenderHealth, type ResultMeta } from './protocol';

/** Thin wrappers over the app server's /api/render routes. */

export class RenderApiError extends Error {
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
    throw new RenderApiError(body.error ?? `Server error ${res.status}`, res.status, body.code);
  return body as T;
}

/** Is the image service configured and running? Static hosting (no app server) reports "not configured". */
export async function fetchRenderHealth(): Promise<RenderHealth> {
  try {
    const res = await fetch('/api/health', { signal: AbortSignal.timeout(4000) });
    if (!res.ok) return { configured: false, reachable: false };
    const j = (await res.json()) as { render?: RenderHealth };
    return j.render ?? { configured: false, reachable: false };
  } catch {
    return { configured: false, reachable: false };
  }
}

export const submitEnhance = (req: EnhanceRequest): Promise<{ id: string }> =>
  fetch('/api/render/enhance', { method: 'POST', body: JSON.stringify(req) }).then((r) => json(r));

export const getJob = (id: string): Promise<JobInfo> =>
  fetch(`/api/render/jobs/${id}`).then((r) => json<JobInfo>(r));

export const cancelJob = (id: string): Promise<JobInfo> =>
  fetch(`/api/render/jobs/${id}`, { method: 'DELETE' }).then((r) => json<JobInfo>(r));

export const listResults = async (projectId: string): Promise<ResultMeta[]> => {
  const r = await fetch(`/api/render/results?project=${encodeURIComponent(projectId)}`);
  // Static hosting answers every URL with the app page: that is "no results", not a list.
  const j: unknown = await json<unknown>(r);
  return Array.isArray(j) ? (j as ResultMeta[]) : [];
};

export const resultUrl = (id: string): string => `/api/render/results/${id}`;
export const styleUrl = (id: string): string => `/api/render/results/${id}/style`;
export const beforeUrl = (id: string): string => `/api/render/results/${id}/before`;

export const deleteResult = (id: string): Promise<unknown> =>
  fetch(`/api/render/results/${id}`, { method: 'DELETE' }).then((r) => json(r));

/** Polls a job every second until it is done, failed or cancelled; `onUpdate` sees every status. */
export async function waitForJob(
  id: string,
  onUpdate: (j: JobInfo) => void,
  signal: AbortSignal,
  intervalMs = 1000,
): Promise<JobInfo> {
  for (;;) {
    if (signal.aborted) throw new RenderApiError('Cancelled', 499);
    const j = await getJob(id);
    onUpdate(j);
    if (j.status === 'done' || j.status === 'error' || j.status === 'cancelled') return j;
    await new Promise((r) => setTimeout(r, intervalMs));
  }
}
