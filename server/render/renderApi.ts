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
import {
  type EnhanceRequest,
  EnhanceRequestSchema,
  type JobInfo,
  type RenderHealth,
  type ResultMeta,
} from '../../src/render/protocol';
import type { GpuQueue } from '../gpuQueue';
import { ComfyClient, ComfyError, firstOutput } from './comfy';
import { WORKFLOW_VERSION, buildWorkflow } from './workflow';

export interface RenderServiceOptions {
  /** Where ComfyUI listens (COMFYUI_URL); null when the render service is not configured. */
  comfyUrl: string | null;
  /** Folder for the app's data ('' or ':memory:' use a temporary folder). Results live in `<dataDir>/renders`. */
  dataDir: string;
  queue: GpuQueue;
}

interface Job {
  id: string;
  status: JobInfo['status'];
  progress: JobInfo['progress'];
  error?: string;
  controller: AbortController;
  startedAt: number;
}

const ID = /^[a-f0-9]{16}$/;
const MAX_BODY = 40 * 1024 * 1024;
const MAX_IMAGE = 8 * 1024 * 1024;
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47]);

function send(res: ServerResponse, status: number, body: unknown): void {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Cache-Control', 'no-store');
  res.end(JSON.stringify(body));
}

function readBody(req: IncomingMessage, max: number): Promise<string> {
  return new Promise((resolve, reject) => {
    let size = 0;
    let tooBig = false;
    const chunks: Buffer[] = [];
    req.on('data', (c: Buffer) => {
      size += c.length;
      if (size > max) tooBig = true;
      else chunks.push(c);
    });
    req.on('end', () =>
      tooBig
        ? reject(Object.assign(new Error('Request too large'), { status: 413 }))
        : resolve(Buffer.concat(chunks).toString('utf8')),
    );
    req.on('error', reject);
  });
}

/** `data:image/png;base64,…` (or bare base64) → a PNG buffer, or null when it is not a reasonable PNG. */
export function decodePng(value: string): Buffer | null {
  const b64 = value.replace(/^data:image\/png;base64,/, '');
  if (!/^[A-Za-z0-9+/=\s]+$/.test(b64)) return null;
  const buf = Buffer.from(b64, 'base64');
  if (buf.length < 64 || buf.length > MAX_IMAGE || !buf.subarray(0, 4).equals(PNG)) return null;
  return buf;
}

/** Unloads whatever model Ollama has in memory so the image model has the whole GPU. Failures are ignored. */
export async function unloadOllama(ollamaUrl: string): Promise<void> {
  try {
    const r = await fetch(`${ollamaUrl}/api/ps`, { signal: AbortSignal.timeout(3000) });
    const j = (await r.json()) as { models?: { name: string }[] };
    await Promise.all(
      (j.models ?? []).map((m) =>
        fetch(`${ollamaUrl}/api/generate`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ model: m.name, keep_alive: 0 }),
          signal: AbortSignal.timeout(10_000),
        }).catch(() => undefined),
      ),
    );
  } catch {
    // Ollama is not running: nothing to unload.
  }
}

/**
 * `/api/render/*`: queue "Enhance render" jobs (ComfyUI), report their progress, and keep the results.
 *
 *   POST   /api/render/enhance          queue a job → { id }
 *   GET    /api/render/jobs/:id         status, queue position, progress
 *   DELETE /api/render/jobs/:id         cancel
 *   GET    /api/render/results?project= list of results for a project
 *   GET    /api/render/results/:id      the enhanced image (png) — /before: the exact render, /meta: its parameters
 *   DELETE /api/render/results/:id      delete
 */
export function createRenderService(opts: RenderServiceOptions) {
  const comfy = opts.comfyUrl ? new ComfyClient(opts.comfyUrl) : null;
  const root = join(
    !opts.dataDir || opts.dataDir === ':memory:'
      ? mkdtempSync(join(tmpdir(), 'dd-renders-'))
      : opts.dataDir,
    'renders',
  );
  mkdirSync(root, { recursive: true });
  const jobs = new Map<string, Job>();

  const dirOf = (id: string) => join(root, id);
  const metaOf = (id: string): ResultMeta | null => {
    try {
      return JSON.parse(readFileSync(join(dirOf(id), 'meta.json'), 'utf8')) as ResultMeta;
    } catch {
      return null;
    }
  };
  const info = (job: Job): JobInfo => ({
    id: job.id,
    status: job.status,
    ahead: Math.max(0, opts.queue.ahead(job.id)),
    gpuBusyWith: opts.queue.snapshot().running?.kind ?? null,
    progress: job.progress,
    error: job.error,
  });

  async function execute(job: Job, req: EnhanceRequest): Promise<void> {
    if (!comfy) throw new ComfyError('The render service is not configured', 503, '');
    job.status = 'running';
    const color = decodePng(req.images.color);
    const depth = decodePng(req.images.depth);
    const edge = req.images.edge ? decodePng(req.images.edge) : null;
    if (!color || !depth || (req.images.edge && !edge))
      throw new ComfyError('The images are not valid PNG pictures', 400, '');
    // Keep the inputs, so "re-run with a new seed" can use exactly the same pictures.
    mkdirSync(dirOf(job.id), { recursive: true });
    writeFileSync(join(dirOf(job.id), 'before.png'), color);
    writeFileSync(join(dirOf(job.id), 'depth.png'), depth);
    if (edge) writeFileSync(join(dirOf(job.id), 'edge.png'), edge);
    const files = {
      color: await comfy.upload(`duplex-${job.id}-color.png`, color),
      depth: await comfy.upload(`duplex-${job.id}-depth.png`, depth),
      edge: edge ? await comfy.upload(`duplex-${job.id}-edge.png`, edge) : undefined,
    };
    const prompt = buildWorkflow(req.params, files);
    // The progress socket must be open before the prompt is queued.
    const tracker = await comfy.track(
      job.id,
      (step, max) => {
        job.progress = { step, max };
      },
      job.controller.signal,
    );
    const onAbort = () => void comfy.interrupt().catch(() => undefined);
    job.controller.signal.addEventListener('abort', onAbort);
    let promptId: string;
    try {
      promptId = await comfy.queue(prompt, job.id);
      await tracker.wait(promptId);
    } finally {
      job.controller.signal.removeEventListener('abort', onAbort);
      tracker.close();
    }
    const out = firstOutput((await comfy.history(promptId))[promptId]);
    if (!out) throw new ComfyError('ComfyUI finished but returned no picture', 502, '');
    const image = await comfy.view(out);
    writeFileSync(join(dirOf(job.id), 'result.png'), image);
    const meta: ResultMeta = {
      id: job.id,
      projectId: req.projectId,
      projectName: req.projectName,
      createdAt: new Date().toISOString(),
      params: req.params,
      width: req.view.width,
      height: req.view.height,
      hasEdge: !!edge,
      view: req.view,
      labels: req.labels,
      workflow: WORKFLOW_VERSION,
    };
    writeFileSync(join(dirOf(job.id), 'meta.json'), JSON.stringify(meta));
  }

  async function enhance(req: IncomingMessage, res: ServerResponse): Promise<void> {
    if (!comfy) {
      return send(res, 503, { error: 'The image service is not set up.', code: 'not-configured' });
    }
    let body: unknown;
    try {
      body = JSON.parse(await readBody(req, MAX_BODY));
    } catch (e) {
      const status = (e as { status?: number }).status ?? 400;
      return send(res, status, { error: status === 413 ? 'Request too large' : 'Invalid JSON' });
    }
    const parsed = EnhanceRequestSchema.safeParse(body);
    if (!parsed.success) {
      const i = parsed.error.issues[0];
      return send(res, 400, { error: `Invalid request: ${i?.path.join('.')} ${i?.message}` });
    }
    await start(res, parsed.data);
  }

  /** Checks ComfyUI is up, queues the job on the GPU queue and answers 202 with its id. */
  async function start(res: ServerResponse, data: EnhanceRequest): Promise<void> {
    if (!comfy)
      return send(res, 503, { error: 'The image service is not set up.', code: 'not-configured' });
    if (!(await comfy.reachable())) {
      return send(res, 503, { error: 'The image service is not running.', code: 'unreachable' });
    }
    const id = randomBytes(8).toString('hex');
    const job: Job = {
      id,
      status: 'queued',
      progress: null,
      controller: new AbortController(),
      startedAt: Date.now(),
    };
    jobs.set(id, job);
    opts.queue
      .run(
        'render',
        async () => {
          if (job.controller.signal.aborted) throw new ComfyError('Cancelled', 499, '');
          await execute(job, data);
          job.status = 'done';
        },
        id,
      )
      .catch((e: unknown) => {
        // A job that did not finish leaves nothing behind.
        if (!metaOf(id)) rmSync(dirOf(id), { recursive: true, force: true });
        if (job.controller.signal.aborted || (e instanceof Error && e.message === 'Cancelled')) {
          job.status = 'cancelled';
          return;
        }
        job.status = 'error';
        job.error =
          e instanceof ComfyError
            ? e.message
            : e instanceof Error && /fetch failed|ECONN|timeout/i.test(e.message)
              ? 'The image service stopped answering.'
              : 'The render failed.';
        if (!(e instanceof ComfyError)) console.error('render job failed:', e);
      });
    send(res, 202, { id });
  }

  function sendFile(res: ServerResponse, file: string, type = 'image/png'): void {
    if (!existsSync(file)) return send(res, 404, { error: 'Not found' });
    res.statusCode = 200;
    res.setHeader('Content-Type', type);
    res.setHeader('Cache-Control', 'private, max-age=3600');
    res.end(readFileSync(file));
  }

  return {
    async health(): Promise<RenderHealth> {
      return { configured: !!comfy, reachable: comfy ? await comfy.reachable() : false };
    },

    /** Returns true when the request was for /api/render/*. */
    async handle(req: IncomingMessage, res: ServerResponse, path: string): Promise<boolean> {
      if (!path.startsWith('/api/render/')) return false;
      const url = new URL(req.url ?? '/', 'http://x');
      const parts = path.split('/').filter(Boolean); // api render <kind> [id] [sub]
      const kind = parts[2];
      const id = parts[3];
      const sub = parts[4];

      if (kind === 'enhance' && req.method === 'POST') {
        await enhance(req, res);
        return true;
      }
      if (kind === 'jobs' && id && ID.test(id)) {
        const job = jobs.get(id);
        if (req.method === 'DELETE') {
          if (!job) {
            send(res, 404, { error: 'Unknown job' });
            return true;
          }
          if (job.status === 'queued' || job.status === 'running') {
            job.controller.abort();
            opts.queue.cancel(id);
            job.status = 'cancelled';
          }
          send(res, 200, info(job));
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
          } satisfies JobInfo);
        else send(res, 404, { error: 'Unknown job' });
        return true;
      }
      if (kind === 'results') {
        if (!id) {
          const project = url.searchParams.get('project');
          const list: ResultMeta[] = [];
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
          return true;
        }
        if (sub === 'rerun' && req.method === 'POST') {
          const meta = metaOf(id)!;
          let seed = Math.floor(Math.random() * 2 ** 32);
          try {
            const j = JSON.parse((await readBody(req, 10_000)) || '{}') as { seed?: unknown };
            if (
              typeof j.seed === 'number' &&
              Number.isInteger(j.seed) &&
              j.seed >= 0 &&
              j.seed < 2 ** 32
            )
              seed = j.seed;
          } catch {
            // an empty or odd body just means "pick a new seed"
          }
          const img = (name: string) => {
            const f = join(dirOf(id), name);
            return existsSync(f)
              ? `data:image/png;base64,${readFileSync(f).toString('base64')}`
              : undefined;
          };
          const color = img('before.png');
          const depth = img('depth.png');
          if (!color || !depth) {
            send(res, 410, { error: 'The pictures of this render are no longer stored.' });
            return true;
          }
          await start(res, {
            projectId: meta.projectId,
            projectName: meta.projectName,
            params: { ...meta.params, seed },
            images: { color, depth, edge: img('edge.png') },
            view: meta.view,
            labels: meta.labels,
          });
          return true;
        }
        if (sub === 'meta') send(res, 200, metaOf(id));
        else if (sub === 'before') sendFile(res, join(dirOf(id), 'before.png'));
        else if (!sub) sendFile(res, join(dirOf(id), 'result.png'));
        else send(res, 404, { error: 'Not found' });
        return true;
      }
      send(res, 404, { error: 'Unknown render route' });
      return true;
    },
  };
}
