import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { type Server, createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { afterEach, describe, expect, it } from 'vitest';
import { createRunner } from '../../docker/blender/runner.mjs';
import { GpuQueue } from '../gpuQueue';
import { floorGlb, triangleGlb } from '../studio/testGlb';
import { createBakeService, splitBakeBundle } from './bakeApi';

/** A bake sidecar for the one-floor test bundle (a 4 × 4 m floor with a lightmap UV set, one lamp above it). */
const sidecar = {
  version: 1,
  projectId: 'p1',
  projectName: 'Test',
  look: 'bake-dusk',
  output: { width: 256, height: 256 },
  camera: {
    matrixWorld: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 3, 0, 1],
    kind: 'perspective',
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
    lamps: [{ id: 'l1', position: [0, 2, 0], color: '#ffd9a0', lumens: 1500, accent: false }],
    windows: [],
  },
  glare: false,
  bake: {
    preset: 'dusk',
    atlasWidth: 256,
    atlasHeight: 128,
    parts: [{ id: 'floor:test', vertexCount: 6, hash: 'abc' }],
  },
};

function bakeBody(glb = floorGlb(), side: unknown = sidecar, uvBytes = 48): Buffer {
  const json = Buffer.from(JSON.stringify(side));
  const head = Buffer.alloc(4);
  head.writeUInt32LE(json.length, 0);
  const mid = Buffer.alloc(4);
  mid.writeUInt32LE(uvBytes, 0);
  return Buffer.concat([head, json, mid, Buffer.alloc(uvBytes, 1), glb]);
}

describe('bake bundle framing', () => {
  it('splits the sidecar, the lightmap UVs and the glb', () => {
    const parts = splitBakeBundle(bakeBody())!;
    expect((parts.sidecar as { projectId: string }).projectId).toBe('p1');
    expect(parts.uv.length).toBe(48);
    expect(parts.glb.subarray(0, 4).toString('latin1')).toBe('glTF');
  });

  it('refuses a body that is not a bake bundle', () => {
    expect(splitBakeBundle(Buffer.from('nope'))).toBeNull();
    expect(splitBakeBundle(bakeBody(Buffer.from('not a glb at all')))).toBeNull();
  });
});

describe('bake service (Blender service stood in by a fake runner)', () => {
  let fake: Server | undefined;
  afterEach(() => void fake?.close());

  async function fakeRunner(ready: boolean): Promise<string> {
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
          ready
            ? { ready: true, version: '4.2', device: 'OPTIX: Fake GPU' }
            : { ready: false, problem: 'no GPU' },
        );
      if (req.method === 'POST') {
        let s = '';
        req.on('data', (c) => (s += c));
        req.on('end', () => {
          const j = JSON.parse(s) as { id: string; kind: string };
          state.set(j.id, j.kind === 'bake' ? 0 : -99);
          send(202, { id: j.id });
        });
        return;
      }
      const id = url.pathname.split('/')[2]!;
      const n = (state.get(id) ?? 0) + 1;
      state.set(id, n);
      send(200, {
        status: n < 2 ? 'running' : 'done',
        progress: { sample: n * 10, total: 20, etaSeconds: 3 },
        result: { scale: 1.7, bake_seconds: 2.5, samples: 20, device: 'OPTIX: Fake GPU' },
      });
    });
    await new Promise<void>((r) => fake!.listen(0, '127.0.0.1', r));
    return `http://127.0.0.1:${(fake!.address() as AddressInfo).port}`;
  }

  const service = (blenderUrl: string | null, dir = mkdtempSync(join(tmpdir(), 'dd-bk-'))) =>
    createBakeService({
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
  ) => {
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

  const KEY = 'a1b2c3d4e5f60718';

  it('is not set up without Blender, and rejects bad requests', async () => {
    const none = service(null);
    const r = await call(none, 'POST', `/api/bake?project=p1&quality=low&key=${KEY}`, bakeBody());
    expect(r.status).toBe(503);
    const svc = service(await fakeRunner(true));
    expect(
      (await call(svc, 'POST', `/api/bake?project=p1&quality=ultra&key=${KEY}`, bakeBody())).status,
    ).toBe(400);
    expect(
      (await call(svc, 'POST', `/api/bake?project=../x&quality=low&key=${KEY}`, bakeBody())).status,
    ).toBe(400);
    expect(
      (await call(svc, 'POST', `/api/bake?project=p1&quality=low&key=${KEY}`, Buffer.from('xx')))
        .status,
    ).toBe(400);
    // the uv bytes must match the part list (6 vertices × 2 floats × 4 bytes)
    expect(
      (
        await call(
          svc,
          'POST',
          `/api/bake?project=p1&quality=low&key=${KEY}`,
          bakeBody(floorGlb(), sidecar, 40),
        )
      ).status,
    ).toBe(400);
  });

  it('refuses when Blender has no GPU', async () => {
    const svc = service(await fakeRunner(false));
    const r = await call(svc, 'POST', `/api/bake?project=p1&quality=low&key=${KEY}`, bakeBody());
    expect(r.status).toBe(503);
  });

  it('runs a bake and keeps one result per project and preset, replacing it atomically', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'dd-bk-'));
    const svc = service(await fakeRunner(true), dir);
    const run = async () => {
      const start = await call(
        svc,
        'POST',
        `/api/bake?project=p1&quality=medium&key=${KEY}`,
        bakeBody(),
      );
      expect(start.status).toBe(202);
      const id = (start.json as { id: string }).id;
      // the fake runner "bakes" instantly: put the atlas where Blender would have written it
      mkdirSync(join(dir, 'studio', id, 'out'), { recursive: true });
      writeFileSync(join(dir, 'studio', id, 'out', 'lightmap.png'), Buffer.from('ATLAS'));
      let status = 'queued';
      for (let i = 0; i < 40 && status !== 'done'; i++) {
        await new Promise((r) => setTimeout(r, 100));
        status = ((await call(svc, 'GET', `/api/bake/jobs/${id}`)).json as { status: string })
          .status;
      }
      expect(status).toBe('done');
    };
    await run();
    const list = (await call(svc, 'GET', '/api/bake/results?project=p1')).json as {
      preset: string;
      key: string;
      scale: number;
      seconds: number;
      quality: string;
    }[];
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({
      preset: 'dusk',
      key: KEY,
      scale: 1.7,
      seconds: 2.5,
      quality: 'medium',
    });
    expect((await call(svc, 'GET', '/api/bake/p1/dusk/lightmap')).raw.toString()).toBe('ATLAS');
    expect((await call(svc, 'GET', '/api/bake/p1/dusk/uv')).raw.length).toBe(48);
    expect((await call(svc, 'GET', '/api/bake/p1/dusk/meta')).status).toBe(200);
    expect((await call(svc, 'GET', '/api/bake/results?project=other')).json).toEqual([]);
    await run(); // a second bake replaces the first
    expect(
      ((await call(svc, 'GET', '/api/bake/results?project=p1')).json as unknown[]).length,
    ).toBe(1);
    expect((await call(svc, 'DELETE', '/api/bake/p1/dusk')).status).toBe(200);
    expect((await call(svc, 'GET', '/api/bake/p1/dusk/lightmap')).status).toBe(404);
  });
});

// The Blender script itself, headless, on a one-floor scene. Skipped where Blender is not installed.
const BLENDER = [process.env.BLENDER_PATH, 'tools/blender-4.2.23-windows-x64/blender.exe'].find(
  (p) => p && existsSync(p),
);

describe.skipIf(!BLENDER)('docker/blender/bake.py (headless Blender)', () => {
  const run = async (glb: Buffer, side: unknown) => {
    const dir = mkdtempSync(join(tmpdir(), 'dd-bake-'));
    mkdirSync(join(dir, 'job1', 'bundle'), { recursive: true });
    writeFileSync(join(dir, 'job1', 'bundle', 'scene.glb'), glb);
    writeFileSync(join(dir, 'job1', 'bundle', 'sidecar.json'), JSON.stringify(side));
    const runner = createRunner({ blender: BLENDER!, jobsDir: dir });
    const { done } = runner.start('job1', 'low', 'bake');
    return { job: await done, out: join(dir, 'job1', 'out') };
  };

  it('bakes the lighting of a floor into its lightmap UV set: a lit atlas and its scale', async () => {
    const { job, out } = await run(floorGlb(), sidecar);
    expect(job.status, job.error).toBe('done');
    const png = readFileSync(join(out, 'lightmap.png'));
    expect(png.subarray(1, 4).toString()).toBe('PNG');
    expect(png.readUInt32BE(16)).toBe(256); // width of the atlas
    expect(png.readUInt32BE(20)).toBe(128);
    expect(job.result).toMatchObject({ samples: 128, width: 256, height: 128, baked_objects: 1 });
    expect(Number(job.result?.scale)).toBeGreaterThan(0);
  }, 240_000);

  it('says what is wrong when the bundle has no lightmap UV set', async () => {
    const { job } = await run(triangleGlb(), sidecar);
    expect(job.status).toBe('error');
    expect(job.error).toMatch(/lightmap UV|stopped/i);
  }, 240_000);
});
