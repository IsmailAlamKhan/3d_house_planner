import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { type Server, createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createRunner } from '../../docker/blender/runner.mjs';
import { GpuQueue } from '../gpuQueue';
import { createStudioService, splitBundle } from './studioApi';

/** A one-triangle glb (valid glTF 2.0 binary) and a minimal sidecar: the smallest thing Blender can render. */
function tinyGlb(): Buffer {
  const positions = Buffer.alloc(36);
  [0, 0, 0, 1, 0, 0, 0, 0, -1].forEach((v, i) => positions.writeFloatLE(v, i * 4));
  const json = {
    asset: { version: '2.0' },
    scene: 0,
    scenes: [{ nodes: [0] }],
    nodes: [{ mesh: 0, extras: { layer: 'slab', id: 'slab:test' } }],
    meshes: [{ primitives: [{ attributes: { POSITION: 0 } }] }],
    accessors: [
      {
        bufferView: 0,
        componentType: 5126,
        count: 3,
        type: 'VEC3',
        min: [0, 0, -1],
        max: [1, 0, 0],
      },
    ],
    bufferViews: [{ buffer: 0, byteLength: 36 }],
    buffers: [{ byteLength: 36 }],
  };
  let j = Buffer.from(JSON.stringify(json));
  j = Buffer.concat([j, Buffer.alloc((4 - (j.length % 4)) % 4, 0x20)]);
  const total = 12 + 8 + j.length + 8 + 36;
  const head = Buffer.alloc(12);
  head.write('glTF', 0, 'latin1');
  head.writeUInt32LE(2, 4);
  head.writeUInt32LE(total, 8);
  const chunk = (len: number, type: string) => {
    const b = Buffer.alloc(8);
    b.writeUInt32LE(len, 0);
    b.write(type, 4, 'latin1');
    return b;
  };
  return Buffer.concat([head, chunk(j.length, 'JSON'), j, chunk(36, 'BIN\0'), positions]);
}

const sidecar = {
  version: 1,
  projectId: 'p1',
  projectName: 'Test',
  look: 'test',
  output: { width: 160, height: 120 },
  camera: {
    // looking down at the triangle from 3 m up (three.js y up), orthographic
    matrixWorld: [1, 0, 0, 0, 0, 0, -1, 0, 0, 1, 0, 0, 0.3, 3, -0.3, 1],
    kind: 'ortho',
    orthoHeight: 2,
    fov: 45,
    near: 0.1,
    far: 50,
  },
  environment: {
    hdri: 'dusk',
    hdriStrength: 1,
    sun: { direction: [0, 1, 0], color: '#ffffff', strength: 0 },
    exposure: 0,
  },
  cutaway: { enabled: false },
  lights: {
    lamps: [{ id: 'l1', position: [0.3, 1.5, -0.3], color: '#ffd9a0', lumens: 800, accent: false }],
    windows: [],
  },
  glare: false,
};

function bundleBody(glb = tinyGlb(), side: unknown = sidecar): Buffer {
  const json = Buffer.from(JSON.stringify(side));
  const head = Buffer.alloc(4);
  head.writeUInt32LE(json.length, 0);
  return Buffer.concat([head, json, glb]);
}

describe('studio bundle framing', () => {
  it('splits the sidecar from the glb', () => {
    const parts = splitBundle(bundleBody())!;
    expect((parts.sidecar as { projectId: string }).projectId).toBe('p1');
    expect(parts.glb.subarray(0, 4).toString('latin1')).toBe('glTF');
  });

  it('refuses a body that is not a bundle', () => {
    expect(splitBundle(Buffer.from('nope'))).toBeNull();
    expect(splitBundle(bundleBody(Buffer.from('not a glb at all')))).toBeNull();
    const bad = Buffer.concat([Buffer.from([2, 0, 0, 0]), Buffer.from('{x'), tinyGlb()]);
    expect(splitBundle(bad)).toBeNull();
  });
});

describe('studio service (Blender service stood in by a fake runner)', () => {
  let fake: Server | undefined;
  afterEach(() => void fake?.close());

  /** A runner that answers like docker/blender/runner.mjs and "renders" a picture instantly. */
  async function fakeRunner(opts: { ready: boolean }): Promise<string> {
    const state = new Map<string, number>();
    fake = createServer((req, res) => {
      const url = new URL(req.url ?? '/', 'http://x');
      const send = (code: number, body: unknown) => {
        res.writeHead(code, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(body));
      };
      if (url.pathname === '/health')
        return send(
          200,
          opts.ready
            ? { ready: true, version: '4.2', device: 'OPTIX: Fake GPU' }
            : { ready: false, problem: 'Blender found no NVIDIA GPU' },
        );
      if (req.method === 'POST') {
        let s = '';
        req.on('data', (c) => (s += c));
        req.on('end', () => {
          const { id } = JSON.parse(s) as { id: string };
          state.set(id, 0);
          send(202, { id });
        });
        return;
      }
      const id = url.pathname.split('/')[2]!;
      const n = (state.get(id) ?? 0) + 1;
      state.set(id, n);
      send(200, {
        status: n < 2 ? 'running' : 'done',
        progress: { sample: n * 10, total: 20, etaSeconds: 3 },
        result: {
          width: 160,
          height: 120,
          samples: 20,
          render_seconds: 1.5,
          device: 'OPTIX: Fake GPU',
        },
      });
    });
    await new Promise<void>((r) => fake!.listen(0, '127.0.0.1', r));
    return `http://127.0.0.1:${(fake!.address() as AddressInfo).port}`;
  }

  const service = (blenderUrl: string | null, dir = mkdtempSync(join(tmpdir(), 'dd-st-'))) =>
    createStudioService({
      blenderPath: null,
      blenderUrl,
      dataDir: dir,
      assetsDir: 'assets',
      queue: new GpuQueue(),
    });

  const call = async (
    svc: ReturnType<typeof service>,
    method: string,
    path: string,
    body?: Buffer,
  ): Promise<{ status: number; json: unknown; raw: Buffer }> => {
    const { Readable } = await import('node:stream');
    const req = Object.assign(Readable.from(body ? [body] : []), { method, url: path });
    const chunks: Buffer[] = [];
    let status = 0;
    const res = {
      statusCode: 200,
      setHeader: () => undefined,
      end(b?: Buffer | string) {
        if (b) chunks.push(Buffer.from(b));
        status = this.statusCode;
      },
    };
    await svc.handle(req as never, res as never, path.split('?')[0]!);
    const raw = Buffer.concat(chunks);
    let json: unknown = null;
    try {
      json = JSON.parse(raw.toString('utf8'));
    } catch {
      // a picture, not JSON
    }
    return { status, json, raw };
  };

  it('says it is not set up when no Blender is configured', async () => {
    const svc = service(null);
    expect(await svc.health()).toEqual({ configured: false, ready: false });
    const r = await call(svc, 'POST', '/api/studio/render?quality=standard', bundleBody());
    expect(r.status).toBe(503);
    expect((r.json as { code: string }).code).toBe('not-configured');
  });

  it('explains when Blender has no GPU', async () => {
    const svc = service(await fakeRunner({ ready: false }));
    const h = await svc.health();
    expect(h.ready).toBe(false);
    expect(h.problem).toMatch(/NVIDIA/);
    const r = await call(svc, 'POST', '/api/studio/render?quality=standard', bundleBody());
    expect(r.status).toBe(503);
  });

  it('rejects bad requests', async () => {
    const svc = service(await fakeRunner({ ready: true }));
    expect((await call(svc, 'POST', '/api/studio/render?quality=ultra', bundleBody())).status).toBe(
      400,
    );
    expect(
      (await call(svc, 'POST', '/api/studio/render?quality=standard', Buffer.from('xx'))).status,
    ).toBe(400);
    expect(
      (
        await call(
          svc,
          'POST',
          '/api/studio/render?quality=standard',
          bundleBody(tinyGlb(), { version: 1 }),
        )
      ).status,
    ).toBe(400);
  });

  it('runs a job: queued, progress, result with its numbers, the picture, and delete', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'dd-st-'));
    const svc = service(await fakeRunner({ ready: true }), dir);
    const start = await call(svc, 'POST', '/api/studio/render?quality=preview', bundleBody());
    expect(start.status).toBe(202);
    const id = (start.json as { id: string }).id;
    // the fake runner "renders" instantly; put a picture where Blender would have written it
    mkdirSync(join(dir, 'studio', id, 'out'), { recursive: true });
    writeFileSync(join(dir, 'studio', id, 'out', 'beauty.png'), Buffer.from('PNG-bytes'));
    let info: { status: string } = { status: 'queued' };
    for (let i = 0; i < 40 && info.status !== 'done'; i++) {
      await new Promise((r) => setTimeout(r, 100));
      info = (await call(svc, 'GET', `/api/studio/jobs/${id}`)).json as { status: string };
    }
    expect(info.status).toBe('done');
    const list = (await call(svc, 'GET', '/api/studio/results?project=p1')).json as {
      id: string;
      seconds: number;
      device: string;
      quality: string;
    }[];
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({
      id,
      seconds: 1.5,
      device: 'OPTIX: Fake GPU',
      quality: 'preview',
    });
    expect((await call(svc, 'GET', `/api/studio/results/${id}`)).raw.toString()).toBe('PNG-bytes');
    expect((await call(svc, 'GET', '/api/studio/results?project=other')).json).toEqual([]);
    // the big glb is not kept
    expect(existsSync(join(dir, 'studio', id, 'bundle'))).toBe(false);
    expect((await call(svc, 'DELETE', `/api/studio/results/${id}`)).status).toBe(200);
    expect((await call(svc, 'GET', `/api/studio/results/${id}`)).status).toBe(404);
  });
});

// The Blender script itself, headless, on a one-triangle scene. Skipped where Blender is not installed.
const BLENDER = [process.env.BLENDER_PATH, 'tools/blender-4.2.23-windows-x64/blender.exe'].find(
  (p) => p && existsSync(p),
);

describe.skipIf(!BLENDER)('docker/blender/render.py (headless Blender)', () => {
  it('renders a bundle with Cycles and writes the picture, depth, mask and a result file', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'dd-blender-'));
    mkdirSync(join(dir, 'job1', 'bundle'), { recursive: true });
    writeFileSync(join(dir, 'job1', 'bundle', 'scene.glb'), tinyGlb());
    writeFileSync(join(dir, 'job1', 'bundle', 'sidecar.json'), JSON.stringify(sidecar));
    const runner = createRunner({ blender: BLENDER!, jobsDir: dir });
    const health = await runner.check(true);
    expect(health.ready, health.problem).toBe(true);
    const { done } = runner.start('job1', 'preview');
    const job = await done;
    expect(job.status, job.error).toBe('done');
    const out = join(dir, 'job1', 'out');
    expect(readFileSync(join(out, 'beauty.png')).subarray(1, 4).toString()).toBe('PNG');
    expect(existsSync(join(out, 'depth.exr'))).toBe(true);
    expect(existsSync(join(out, 'mask.png'))).toBe(true);
    expect(job.result).toMatchObject({ samples: 64, lamps: 1 });
    expect(String(job.result?.device)).toMatch(/OPTIX|CUDA|CPU/);
  }, 180_000);
});
