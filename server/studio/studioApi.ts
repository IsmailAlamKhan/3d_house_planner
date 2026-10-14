import { randomBytes } from 'node:crypto';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRunner } from '../../docker/blender/runner.mjs';
import {
  STUDIO_QUALITIES,
  type StudioHealth,
  type StudioJobInfo,
  type StudioQuality,
  type StudioResultMeta,
  StudioSidecarSchema,
} from '../../src/studio/protocol';
import type { GpuQueue } from '../gpuQueue';

export interface StudioServiceOptions {
  /** A Blender on this machine (BLENDER_PATH); the server runs the jobs itself. */
  blenderPath: string | null;
  /** The `blender` Docker service (BLENDER_URL); jobs are handed to it through the shared data folder. */
  blenderUrl: string | null;
  /** The app's data folder: bundles and results live in `<dataDir>/studio`. */
  dataDir: string;
  assetsDir: string;
  queue: GpuQueue;
}

const ID = /^[a-f0-9]{16}$/;
const MAX_BUNDLE = 600 * 1024 * 1024;

interface Job {
  id: string;
  status: StudioJobInfo['status'];
  progress: StudioJobInfo['progress'];
  error?: string;
  controller: AbortController;
}

interface BackendHealth {
  ready: boolean;
  version?: string;
  device?: string;
  problem?: string;
}

/** One way to run a render: Blender here, or the Blender container. Resolves when the render has ended. */
interface Backend {
  check(): Promise<BackendHealth>;
  run(
    id: string,
    quality: StudioQuality,
    onProgress: (p: NonNullable<StudioJobInfo['progress']>) => void,
    signal: AbortSignal,
  ): Promise<Record<string, unknown> | undefined>;
}

function send(res: ServerResponse, status: number, body: unknown): void {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Cache-Control', 'no-store');
  res.end(JSON.stringify(body));
}

function readBinary(req: IncomingMessage, max: number): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    let tooBig = false;
    req.on('data', (c: Buffer) => {
      size += c.length;
      if (size > max) tooBig = true;
      else chunks.push(c);
    });
    req.on('end', () =>
      tooBig
        ? reject(Object.assign(new Error('Request too large'), { status: 413 }))
        : resolve(Buffer.concat(chunks)),
    );
    req.on('error', reject);
  });
}

/** Splits a request body: 4 bytes (little endian) length, the sidecar JSON, then the glb. */
export function splitBundle(body: Buffer): { sidecar: unknown; glb: Buffer } | null {
  if (body.length < 8) return null;
  const n = body.readUInt32LE(0);
  if (n < 2 || 4 + n >= body.length) return null;
  const glb = body.subarray(4 + n);
  if (glb.subarray(0, 4).toString('latin1') !== 'glTF') return null;
  try {
    return { sidecar: JSON.parse(body.subarray(4, 4 + n).toString('utf8')), glb };
  } catch {
    return null;
  }
}

/** The runner of this machine's Blender (BLENDER_PATH). */
function localBackend(blender: string, jobsDir: string, assetsDir: string): Backend {
  const runner = createRunner({ blender, jobsDir, assetsDir });
  return {
    check: () => runner.check(),
    async run(id, quality, onProgress, signal) {
      const { job, done } = runner.start(id, quality);
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
function remoteBackend(url: string): Backend {
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
    async run(id, quality, onProgress, signal) {
      const r = await fetch(`${base}/jobs`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, quality }),
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

/**
 * `/api/studio/*`: studio renders with Blender Cycles on the shared GPU queue.
 *
 *   POST   /api/studio/render?quality=   body: sidecar length (u32 LE) + sidecar JSON + glb  → { id }
 *   GET    /api/studio/jobs/:id          status, queue position, samples and ETA
 *   DELETE /api/studio/jobs/:id          cancel
 *   GET    /api/studio/results[?project=] results of a project, newest first
 *   GET    /api/studio/results/:id[/meta|/depth|/mask]   the picture (png), its numbers, the depth (exr) and mask (png) passes
 *   DELETE /api/studio/results/:id
 */
export function createStudioService(opts: StudioServiceOptions) {
  const base =
    !opts.dataDir || opts.dataDir === ':memory:'
      ? mkdtempSync(join(tmpdir(), 'dd-studio-'))
      : opts.dataDir;
  const root = join(base, 'studio');
  mkdirSync(root, { recursive: true });
  const backend: Backend | null = opts.blenderUrl
    ? remoteBackend(opts.blenderUrl)
    : opts.blenderPath
      ? localBackend(opts.blenderPath, root, opts.assetsDir)
      : null;
  const jobs = new Map<string, Job>();

  const dirOf = (id: string) => join(root, id);
  const metaOf = (id: string): StudioResultMeta | null => {
    try {
      return JSON.parse(readFileSync(join(dirOf(id), 'meta.json'), 'utf8')) as StudioResultMeta;
    } catch {
      return null;
    }
  };
  const info = (job: Job): StudioJobInfo => {
    const running = opts.queue.snapshot().running;
    return {
      id: job.id,
      status: job.status,
      ahead: Math.max(0, opts.queue.ahead(job.id)),
      gpuBusyWith: running ? (running.kind === 'render' ? 'render' : 'design') : null,
      progress: job.progress,
      error: job.error,
    };
  };

  async function render(req: IncomingMessage, res: ServerResponse, url: URL): Promise<void> {
    if (!backend)
      return send(res, 503, { error: 'Studio render is not set up.', code: 'not-configured' });
    const quality = url.searchParams.get('quality') as StudioQuality;
    if (!STUDIO_QUALITIES.includes(quality)) return send(res, 400, { error: 'Unknown quality' });
    let body: Buffer;
    try {
      body = await readBinary(req, MAX_BUNDLE);
    } catch (e) {
      const status = (e as { status?: number }).status ?? 400;
      return send(res, status, { error: status === 413 ? 'Request too large' : 'Bad request' });
    }
    const parts = splitBundle(body);
    if (!parts) return send(res, 400, { error: 'The studio bundle is not valid.' });
    const side = StudioSidecarSchema.safeParse(parts.sidecar);
    if (!side.success) {
      const i = side.error.issues[0];
      return send(res, 400, { error: `Invalid bundle: ${i?.path.join('.')} ${i?.message}` });
    }
    const health = await backend.check();
    if (!health.ready)
      return send(res, 503, {
        error: health.problem ?? 'Blender is not ready.',
        code: 'unreachable',
      });

    const id = randomBytes(8).toString('hex');
    const dir = dirOf(id);
    mkdirSync(join(dir, 'bundle'), { recursive: true });
    mkdirSync(join(dir, 'out'), { recursive: true });
    writeFileSync(join(dir, 'bundle', 'scene.glb'), parts.glb);
    writeFileSync(join(dir, 'bundle', 'sidecar.json'), JSON.stringify(side.data));
    const job: Job = { id, status: 'queued', progress: null, controller: new AbortController() };
    jobs.set(id, job);
    opts.queue
      .run(
        'render',
        async () => {
          if (job.controller.signal.aborted) throw new Error('Cancelled');
          job.status = 'running';
          const t0 = Date.now();
          const result = await backend.run(
            id,
            quality,
            (p) => (job.progress = p),
            job.controller.signal,
          );
          const out = (name: string) => existsSync(join(dir, 'out', name));
          const meta: StudioResultMeta = {
            id,
            kind: 'studio',
            projectId: side.data.projectId,
            projectName: side.data.projectName,
            look: side.data.look,
            quality,
            createdAt: new Date().toISOString(),
            width: Number(result?.width ?? side.data.output.width),
            height: Number(result?.height ?? side.data.output.height),
            samples: Number(result?.samples ?? 0),
            seconds: Number(result?.render_seconds ?? (Date.now() - t0) / 1000),
            device: String(result?.device ?? health.device ?? ''),
            viewProjection: side.data.viewProjection ?? [],
            hasMask: out('mask.png'),
            hasDepth: out('depth.exr'),
          };
          writeFileSync(join(dir, 'meta.json'), JSON.stringify(meta));
          // the bundle is big and not needed again
          rmSync(join(dir, 'bundle'), { recursive: true, force: true });
          job.status = 'done';
        },
        id,
      )
      .catch((e: unknown) => {
        if (!metaOf(id)) rmSync(dir, { recursive: true, force: true });
        if (job.controller.signal.aborted || (e instanceof Error && e.message === 'Cancelled')) {
          job.status = 'cancelled';
          return;
        }
        job.status = 'error';
        job.error = e instanceof Error ? e.message : 'The render failed.';
      });
    send(res, 202, { id });
  }

  function sendFile(res: ServerResponse, file: string, type: string): void {
    if (!existsSync(file)) return send(res, 404, { error: 'Not found' });
    res.statusCode = 200;
    res.setHeader('Content-Type', type);
    res.setHeader('Cache-Control', 'private, max-age=3600');
    res.end(readFileSync(file));
  }

  return {
    async health(): Promise<StudioHealth> {
      if (!backend) return { configured: false, ready: false };
      const h = await backend.check();
      return { configured: true, ...h };
    },

    /** Returns true when the request was for /api/studio/*. */
    async handle(req: IncomingMessage, res: ServerResponse, path: string): Promise<boolean> {
      if (!path.startsWith('/api/studio/')) return false;
      const url = new URL(req.url ?? '/', 'http://x');
      const [, , , kind, id, sub] = path.split('/');
      if (kind === 'render' && req.method === 'POST') {
        await render(req, res, url);
        return true;
      }
      if (kind === 'jobs' && id && ID.test(id)) {
        const job = jobs.get(id);
        if (req.method === 'DELETE') {
          if (!job) send(res, 404, { error: 'Unknown job' });
          else {
            if (job.status === 'queued' || job.status === 'running') {
              job.controller.abort();
              opts.queue.cancel(id);
              job.status = 'cancelled';
            }
            send(res, 200, info(job));
          }
          return true;
        }
        if (job) send(res, 200, info(job));
        else if (metaOf(id))
          send(res, 200, {
            id,
            status: 'done',
            ahead: 0,
            gpuBusyWith: null,
            progress: null,
          } satisfies StudioJobInfo);
        else send(res, 404, { error: 'Unknown job' });
        return true;
      }
      if (kind === 'results') {
        if (!id) {
          const project = url.searchParams.get('project');
          const list: StudioResultMeta[] = [];
          for (const name of existsSync(root) ? readdirSync(root) : []) {
            const m = ID.test(name) ? metaOf(name) : null;
            if (m && (!project || m.projectId === project)) list.push(m);
          }
          list.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
          send(res, 200, list);
          return true;
        }
        if (!ID.test(id) || !metaOf(id)) {
          send(res, 404, { error: 'Not found' });
          return true;
        }
        if (req.method === 'DELETE') {
          rmSync(dirOf(id), { recursive: true, force: true });
          jobs.delete(id);
          send(res, 200, { deleted: id });
        } else if (sub === 'meta') send(res, 200, metaOf(id));
        else if (sub === 'depth') sendFile(res, join(dirOf(id), 'out', 'depth.exr'), 'image/x-exr');
        else if (sub === 'mask') sendFile(res, join(dirOf(id), 'out', 'mask.png'), 'image/png');
        else if (!sub) sendFile(res, join(dirOf(id), 'out', 'beauty.png'), 'image/png');
        else send(res, 404, { error: 'Not found' });
        return true;
      }
      send(res, 404, { error: 'Unknown studio route' });
      return true;
    },
  };
}
