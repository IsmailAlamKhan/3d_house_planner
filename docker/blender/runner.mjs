// Blender job runner for the studio render. Dependency-free (Node 20+), used two ways:
//   - imported by the app server (BLENDER_PATH set: Blender runs on the same machine), and
//   - as the HTTP service of the `blender` Docker container:  node runner.mjs   (PORT, BLENDER, JOBS_DIR, ASSETS_DIR)
// A job lives in `<jobsDir>/<id>/`: `bundle/{scene.glb,sidecar.json}` in, `out/{beauty.png,depth.exr,mask.png,result.json}` out.
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const SAMPLE = /Sample (\d+)\/(\d+)/;
const REMAINING = /Remaining:(?:(\d+):)?(\d+):(\d+(?:\.\d+)?)/;
const NVIDIA = /nvidia|geforce|rtx|quadro|tesla/i;

/** `HH:MM:SS.ss` or `MM:SS.ss` from Blender's status line → seconds. */
const toSeconds = (h, m, s) => Number(h ?? 0) * 3600 + Number(m) * 60 + Number(s);

const HEALTH_SCRIPT = `
import bpy, json
p = bpy.context.preferences.addons['cycles'].preferences
found = None
for kind in ('OPTIX', 'CUDA'):
    try:
        p.compute_device_type = kind
        p.get_devices()
    except Exception:
        continue
    gpus = [d.name for d in p.devices if d.type == kind]
    if gpus:
        found = kind + ': ' + ', '.join(gpus)
        break
print('HEALTH ' + json.dumps({'version': bpy.app.version_string, 'device': found}))
`;

export function createRunner({
  blender,
  script = join(HERE, 'render.py'),
  jobsDir,
  assetsDir = 'assets',
  spawnFn = spawn,
}) {
  const jobs = new Map();
  let health = null;
  let healthAt = 0;

  /** Is Blender there, and does Cycles have an NVIDIA GPU (OptiX / CUDA)? Cached for a minute. */
  async function check(force = false) {
    if (!force && health && Date.now() - healthAt < 60_000) return health;
    health = await new Promise((resolve) => {
      let out = '';
      let child;
      try {
        child = spawnFn(blender, ['-b', '--factory-startup', '--python-expr', HEALTH_SCRIPT], {
          stdio: ['ignore', 'pipe', 'pipe'],
        });
      } catch (e) {
        return resolve({ ready: false, problem: `Blender could not be started: ${e.message}` });
      }
      const timer = setTimeout(() => child.kill(), 60_000);
      child.stdout.on('data', (d) => (out += d));
      child.on('error', (e) =>
        resolve({ ready: false, problem: `Blender could not be started: ${e.message}` }),
      );
      child.on('close', () => {
        clearTimeout(timer);
        const line = out.split('\n').find((l) => l.startsWith('HEALTH '));
        if (!line) return resolve({ ready: false, problem: 'Blender did not answer.' });
        const h = JSON.parse(line.slice(7));
        if (h.device && NVIDIA.test(h.device))
          resolve({ ready: true, version: h.version, device: h.device });
        else
          resolve({
            ready: false,
            version: h.version,
            problem:
              'Blender found no NVIDIA GPU for Cycles (OptiX or CUDA). Check the NVIDIA driver and, in Docker, the GPU runtime.',
          });
      });
    });
    healthAt = Date.now();
    return health;
  }

  /** Starts a render of the bundle already written to `<jobsDir>/<id>/bundle`. */
  function start(id, quality) {
    const dir = resolve(jobsDir, id); // absolute: Blender's working folder is not ours
    const job = {
      id,
      status: 'running',
      progress: null,
      error: undefined,
      startedAt: Date.now(),
      child: null,
    };
    jobs.set(id, job);
    const child = spawnFn(
      blender,
      [
        '-b',
        '--factory-startup',
        '-P',
        script,
        '--',
        join(dir, 'bundle'),
        join(dir, 'out'),
        quality,
      ],
      {
        env: { ...process.env, ASSETS_DIR: resolve(assetsDir) },
        stdio: ['ignore', 'pipe', 'pipe'],
      },
    );
    job.child = child;
    let tail = '';
    const onData = (d) => {
      const text = String(d);
      tail = (tail + text).slice(-4000);
      for (const line of text.split(/\r?\n/)) {
        const s = SAMPLE.exec(line);
        if (!s) continue;
        const r = REMAINING.exec(line);
        job.progress = {
          sample: Number(s[1]),
          total: Number(s[2]),
          etaSeconds: r ? Math.round(toSeconds(r[1], r[2], r[3])) : null,
        };
      }
    };
    child.stdout.on('data', onData);
    child.stderr.on('data', onData);
    const done = new Promise((resolve) => {
      child.on('error', (e) => {
        job.status = 'error';
        job.error = `Blender could not be started: ${e.message}`;
        resolve(job);
      });
      child.on('close', (code) => {
        job.child = null;
        if (job.status === 'cancelled') return resolve(job);
        const ok = code === 0 && existsSync(join(dir, 'out', 'beauty.png'));
        job.status = ok ? 'done' : 'error';
        if (!ok) {
          const line = tail
            .split('\n')
            .reverse()
            .find((l) => /Error|Traceback/.test(l));
          job.error = `Blender stopped with code ${code}.${line ? ` ${line.trim()}` : ''}`;
        } else {
          try {
            job.result = JSON.parse(readFileSync(join(dir, 'out', 'result.json'), 'utf8'));
          } catch {
            // the picture exists; the numbers are a bonus
          }
        }
        resolve(job);
      });
    });
    return { job, done };
  }

  function cancel(id) {
    const job = jobs.get(id);
    if (!job || !job.child) return false;
    job.status = 'cancelled';
    job.child.kill();
    return true;
  }

  const info = (id) => {
    const j = jobs.get(id);
    return j
      ? { id, status: j.status, progress: j.progress, error: j.error, result: j.result }
      : null;
  };

  return { check, start, cancel, info };
}

// ───────────────────────────── the container's HTTP service ─────────────────────────────

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const runner = createRunner({
    blender: process.env.BLENDER ?? 'blender',
    jobsDir: process.env.JOBS_DIR ?? '/data/studio',
    assetsDir: process.env.ASSETS_DIR ?? '/assets',
  });
  const json = (res, status, body) => {
    res.writeHead(status, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(body));
  };
  const body = (req) =>
    new Promise((resolve) => {
      let s = '';
      req.on('data', (c) => (s += c));
      req.on('end', () => resolve(s));
    });
  createServer(async (req, res) => {
    const url = new URL(req.url ?? '/', 'http://x');
    const [, kind, id] = url.pathname.split('/');
    if (kind === 'health') return json(res, 200, await runner.check(url.searchParams.has('force')));
    if (kind === 'jobs' && req.method === 'POST') {
      let j;
      try {
        j = JSON.parse((await body(req)) || '{}');
      } catch {
        return json(res, 400, { error: 'Invalid JSON' });
      }
      if (
        !/^[a-f0-9]{16}$/.test(j.id ?? '') ||
        !['preview', 'standard', 'poster'].includes(j.quality)
      )
        return json(res, 400, { error: 'Invalid job' });
      runner.start(j.id, j.quality);
      return json(res, 202, { id: j.id });
    }
    if (kind === 'jobs' && id) {
      if (req.method === 'DELETE') return json(res, 200, { cancelled: runner.cancel(id) });
      const i = runner.info(id);
      return i ? json(res, 200, i) : json(res, 404, { error: 'Unknown job' });
    }
    json(res, 404, { error: 'Not found' });
  }).listen(Number(process.env.PORT ?? 9000), '0.0.0.0', () =>
    console.log(`blender runner on :${process.env.PORT ?? 9000}`),
  );
}
