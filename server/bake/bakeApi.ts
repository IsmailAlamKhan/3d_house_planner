import { randomBytes } from 'node:crypto';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  BAKE_QUALITIES,
  type BakeMeta,
  type BakeQuality,
  BakeSidecarSchema,
} from '../../src/bake/protocol';
import type { StudioJobInfo } from '../../src/studio/protocol';
import type { GpuQueue } from '../gpuQueue';
import { localBackend, remoteBackend, type Backend } from '../studio/backend';
import { readBinary, send } from '../studio/studioApi';

export interface BakeServiceOptions {
  blenderPath: string | null;
  blenderUrl: string | null;
  dataDir: string;
  assetsDir: string;
  queue: GpuQueue;
}

const ID = /^[a-f0-9]{16}$/;
const PROJECT = /^[A-Za-z0-9_-]{1,64}$/;
const PRESET = /^(day|dusk|night)$/;
const MAX_BUNDLE = 600 * 1024 * 1024;

interface Job {
  id: string;
  status: StudioJobInfo['status'];
  progress: StudioJobInfo['progress'];
  error?: string;
  controller: AbortController;
}

/**
 * Body of a bake request: 4 bytes (little endian) sidecar length, the sidecar JSON, 4 bytes uv length, the lightmap UV
 * coordinates of the baked parts (Float32, in the order of `bake.parts`), then the glb.
 */
export function splitBakeBundle(
  body: Buffer,
): { sidecar: unknown; uv: Buffer; glb: Buffer } | null {
  if (body.length < 16) return null;
  const n = body.readUInt32LE(0);
  if (n < 2 || 8 + n >= body.length) return null;
  const m = body.readUInt32LE(4 + n);
  const glbStart = 8 + n + m;
  if (glbStart >= body.length) return null;
  const glb = body.subarray(glbStart);
  if (glb.subarray(0, 4).toString('latin1') !== 'glTF') return null;
  try {
    return {
      sidecar: JSON.parse(body.subarray(4, 4 + n).toString('utf8')),
      uv: body.subarray(8 + n, glbStart),
      glb,
    };
  } catch {
    return null;
  }
}

/**
 * `/api/bake/*`: lighting bakes with Blender on the shared GPU queue.
 *
 *   POST   /api/bake?project=&quality=&key=   body: see splitBakeBundle  → { id }
 *   GET    /api/bake/jobs/:id                 status, queue position, samples and ETA
 *   DELETE /api/bake/jobs/:id                 cancel
 *   GET    /api/bake/results?project=         the bakes of a project (one per lighting preset)
 *   GET    /api/bake/:project/:preset/meta | lightmap | uv     the meta, the atlas (png), the lightmap UVs (Float32)
 *   DELETE /api/bake/:project/:preset
 */
export function createBakeService(opts: BakeServiceOptions) {
  const base =
    !opts.dataDir || opts.dataDir === ':memory:'
      ? mkdtempSync(join(tmpdir(), 'dd-bake-'))
      : opts.dataDir;
  const jobsRoot = join(base, 'studio');
  const bakesRoot = join(base, 'bakes');
  mkdirSync(jobsRoot, { recursive: true });
  mkdirSync(bakesRoot, { recursive: true });
  const backend: Backend | null = opts.blenderUrl
    ? remoteBackend(opts.blenderUrl)
    : opts.blenderPath
      ? localBackend(opts.blenderPath, jobsRoot, opts.assetsDir)
      : null;
  const jobs = new Map<string, Job>();

  const bakeDir = (project: string, preset: string) => join(bakesRoot, project, preset);
  const metaOf = (project: string, preset: string): BakeMeta | null => {
    try {
      return JSON.parse(
        readFileSync(join(bakeDir(project, preset), 'meta.json'), 'utf8'),
      ) as BakeMeta;
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

  async function start(req: IncomingMessage, res: ServerResponse, url: URL): Promise<void> {
    if (!backend) return send(res, 503, { error: 'Baking is not set up.', code: 'not-configured' });
    const quality = url.searchParams.get('quality') as BakeQuality;
    const project = url.searchParams.get('project') ?? '';
    const key = url.searchParams.get('key') ?? '';
    if (!BAKE_QUALITIES.includes(quality)) return send(res, 400, { error: 'Unknown quality' });
    if (!PROJECT.test(project) || !/^[a-f0-9]{8,64}$/.test(key))
      return send(res, 400, { error: 'Bad project or key' });
    let body: Buffer;
    try {
      body = await readBinary(req, MAX_BUNDLE);
    } catch (e) {
      const status = (e as { status?: number }).status ?? 400;
      return send(res, status, { error: status === 413 ? 'Request too large' : 'Bad request' });
    }
    const parts = splitBakeBundle(body);
    if (!parts) return send(res, 400, { error: 'The bake bundle is not valid.' });
    const side = BakeSidecarSchema.safeParse(parts.sidecar);
    if (!side.success) {
      const i = side.error.issues[0];
      return send(res, 400, { error: `Invalid bundle: ${i?.path.join('.')} ${i?.message}` });
    }
    const expectedUv = side.data.bake.parts.reduce((n, p) => n + p.vertexCount * 8, 0);
    if (parts.uv.length !== expectedUv)
      return send(res, 400, { error: 'The lightmap UVs do not match the part list.' });
    const health = await backend.check();
    if (!health.ready)
      return send(res, 503, {
        error: health.problem ?? 'Blender is not ready.',
        code: 'unreachable',
      });

    const id = randomBytes(8).toString('hex');
    const dir = join(jobsRoot, id);
    mkdirSync(join(dir, 'bundle'), { recursive: true });
    mkdirSync(join(dir, 'out'), { recursive: true });
    writeFileSync(join(dir, 'bundle', 'scene.glb'), parts.glb);
    writeFileSync(join(dir, 'bundle', 'sidecar.json'), JSON.stringify(side.data));
    const job: Job = { id, status: 'queued', progress: null, controller: new AbortController() };
    jobs.set(id, job);
    const preset = side.data.bake.preset;
    opts.queue
      .run(
        'render',
        async () => {
          if (job.controller.signal.aborted) throw new Error('Cancelled');
          job.status = 'running';
          const result = await backend.run(
            id,
            quality,
            'bake',
            (p) => (job.progress = p),
            job.controller.signal,
          );
          const meta: BakeMeta = {
            projectId: project,
            preset,
            quality,
            key,
            createdAt: new Date().toISOString(),
            atlas: { width: side.data.bake.atlasWidth, height: side.data.bake.atlasHeight },
            scale: Number(result?.scale ?? 1),
            seconds: Number(result?.bake_seconds ?? 0),
            samples: Number(result?.samples ?? 0),
            device: String(result?.device ?? health.device ?? ''),
            parts: side.data.bake.parts,
          };
          // a finished bake replaces the previous one of this project and preset, all at once
          const dest = bakeDir(project, preset);
          const tmp = `${dest}.new`;
          rmSync(tmp, { recursive: true, force: true });
          mkdirSync(tmp, { recursive: true });
          renameSync(join(dir, 'out', 'lightmap.png'), join(tmp, 'lightmap.png'));
          writeFileSync(join(tmp, 'uv.bin'), parts.uv);
          writeFileSync(join(tmp, 'meta.json'), JSON.stringify(meta));
          rmSync(dest, { recursive: true, force: true });
          renameSync(tmp, dest);
          rmSync(dir, { recursive: true, force: true });
          job.status = 'done';
        },
        id,
      )
      .catch((e: unknown) => {
        rmSync(dir, { recursive: true, force: true });
        if (job.controller.signal.aborted || (e instanceof Error && e.message === 'Cancelled')) {
          job.status = 'cancelled';
          return;
        }
        job.status = 'error';
        job.error = e instanceof Error ? e.message : 'The bake failed.';
      });
    send(res, 202, { id });
  }

  function sendFile(res: ServerResponse, file: string, type: string): void {
    if (!existsSync(file)) return send(res, 404, { error: 'Not found' });
    res.statusCode = 200;
    res.setHeader('Content-Type', type);
    res.setHeader('Cache-Control', 'no-cache');
    res.end(readFileSync(file));
  }

  return {
    /** Returns true when the request was for /api/bake. */
    async handle(req: IncomingMessage, res: ServerResponse, path: string): Promise<boolean> {
      if (path !== '/api/bake' && !path.startsWith('/api/bake/')) return false;
      const url = new URL(req.url ?? '/', 'http://x');
      const [, , , a, b, c] = path.split('/');
      if (path === '/api/bake' && req.method === 'POST') {
        await start(req, res, url);
        return true;
      }
      if (a === 'jobs' && b && ID.test(b)) {
        const job = jobs.get(b);
        if (!job) send(res, 404, { error: 'Unknown job' });
        else if (req.method === 'DELETE') {
          if (job.status === 'queued' || job.status === 'running') {
            job.controller.abort();
            opts.queue.cancel(b);
            job.status = 'cancelled';
          }
          send(res, 200, info(job));
        } else send(res, 200, info(job));
        return true;
      }
      if (a === 'results') {
        const project = url.searchParams.get('project') ?? '';
        const list: BakeMeta[] = [];
        if (PROJECT.test(project))
          for (const preset of existsSync(join(bakesRoot, project))
            ? readdirSync(join(bakesRoot, project))
            : []) {
            const m = PRESET.test(preset) ? metaOf(project, preset) : null;
            if (m) list.push(m);
          }
        send(res, 200, list);
        return true;
      }
      if (a && b && PROJECT.test(a) && PRESET.test(b)) {
        const m = metaOf(a, b);
        if (!m) send(res, 404, { error: 'Not found' });
        else if (req.method === 'DELETE') {
          rmSync(bakeDir(a, b), { recursive: true, force: true });
          send(res, 200, { deleted: `${a}/${b}` });
        } else if (c === 'meta') send(res, 200, m);
        else if (c === 'lightmap') sendFile(res, join(bakeDir(a, b), 'lightmap.png'), 'image/png');
        else if (c === 'uv')
          sendFile(res, join(bakeDir(a, b), 'uv.bin'), 'application/octet-stream');
        else send(res, 404, { error: 'Not found' });
        return true;
      }
      send(res, 404, { error: 'Unknown bake route' });
      return true;
    },
  };
}
