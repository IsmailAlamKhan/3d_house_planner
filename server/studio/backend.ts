import { createRunner } from '../../docker/blender/runner.mjs';
import type { StudioJobInfo } from '../../src/studio/protocol';

export type JobKind = 'render' | 'bake';

export interface BackendHealth {
  ready: boolean;
  version?: string;
  device?: string;
  problem?: string;
}

/** One way to run a render: Blender here, or the Blender container. Resolves when the render has ended. */
export interface Backend {
  check(): Promise<BackendHealth>;
  run(
    id: string,
    quality: string,
    kind: JobKind,
    onProgress: (p: NonNullable<StudioJobInfo['progress']>) => void,
    signal: AbortSignal,
  ): Promise<Record<string, unknown> | undefined>;
}

/** The runner of this machine's Blender (BLENDER_PATH). */
export function localBackend(blender: string, jobsDir: string, assetsDir: string): Backend {
  const runner = createRunner({ blender, jobsDir, assetsDir });
  return {
    check: () => runner.check(),
    async run(id, quality, kind, onProgress, signal) {
      const { job, done } = runner.start(id, quality, kind);
      const onAbort = () => runner.cancel(id);
      signal.addEventListener('abort', onAbort);
      const timer = setInterval(() => job.progress && onProgress(job.progress), 500);
      try {
        const r = await done;
        if (r.status === 'cancelled') throw new Error('Cancelled');
        if (r.status !== 'done') throw new Error(r.error ?? 'Blender failed');
        return r.result;
      } finally {
        clearInterval(timer);
        signal.removeEventListener('abort', onAbort);
      }
    },
  };
}

/** The `blender` container: its HTTP runner shares the data folder with this server. */
export function remoteBackend(url: string): Backend {
  const base = url.replace(/\/+$/, '');
  return {
    async check() {
      try {
        const r = await fetch(`${base}/health`, { signal: AbortSignal.timeout(70_000) });
        return (await r.json()) as BackendHealth;
      } catch {
        return { ready: false, problem: 'The Blender service is not running.' };
      }
    },
    async run(id, quality, kind, onProgress, signal) {
      const r = await fetch(`${base}/jobs`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, quality, kind }),
      });
      if (!r.ok) throw new Error('The Blender service refused the job.');
      const onAbort = () =>
        void fetch(`${base}/jobs/${id}`, { method: 'DELETE' }).catch(() => undefined);
      signal.addEventListener('abort', onAbort);
      try {
        for (;;) {
          await new Promise((res) => setTimeout(res, 800));
          const s = await fetch(`${base}/jobs/${id}`);
          const j = (await s.json()) as {
            status: string;
            progress: StudioJobInfo['progress'];
            error?: string;
            result?: Record<string, unknown>;
          };
          if (j.progress) onProgress(j.progress);
          if (j.status === 'cancelled') throw new Error('Cancelled');
          if (j.status === 'error') throw new Error(j.error ?? 'Blender failed');
          if (j.status === 'done') return j.result;
        }
      } finally {
        signal.removeEventListener('abort', onAbort);
      }
    },
  };
}
