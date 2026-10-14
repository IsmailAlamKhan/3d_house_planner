import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Page } from '@playwright/test';

export const OUT = 'test-results/gpu';
mkdirSync(OUT, { recursive: true });

/** The Reference Villa as a project, built by the committed build script. */
export function villaProject(): unknown {
  const out = join(mkdtempSync(join(tmpdir(), 'dd-gpu-')), 'villa.json');
  execFileSync(
    process.execPath,
    [
      'node_modules/tsx/dist/cli.mjs',
      'scripts/reference-build.ts',
      'reference/villa.spec.json',
      '--out',
      out,
      '--no-fidelity',
    ],
    { stdio: 'ignore' },
  );
  return JSON.parse(readFileSync(out, 'utf8'));
}

interface Duplex {
  __duplex: {
    stores: {
      model: {
        getState: () => { loadProject: (p: unknown) => void; setViewMode: (m: string) => void };
      };
      scene: { getState: () => { setPref: (k: string, v: unknown) => void } };
    };
  };
}

export async function loadVilla(
  page: Page,
  project: unknown,
  opts: { quality?: string; lighting?: { mode: string; time: number } } = {},
): Promise<void> {
  await page.goto('/');
  await page.evaluate(
    ([p, o]) => {
      const d = (window as unknown as Duplex).__duplex.stores;
      d.model.getState().loadProject(p);
      d.model.getState().setViewMode('3d');
      const opt = o as { quality?: string; lighting?: unknown };
      d.scene.getState().setPref('quality', opt.quality ?? 'medium');
      d.scene.getState().setPref('showFps', true);
      if (opt.lighting) d.scene.getState().setPref('lighting', opt.lighting);
    },
    [project, opts] as const,
  );
}

/** Goes to one of the villa's saved views with the view strip, like a person would. */
export async function goToView(page: Page, name: string): Promise<void> {
  await page.getByRole('button', { name, exact: false }).filter({ hasText: name }).first().click();
}

/** Frames per second over `ms` (counted with requestAnimationFrame in the page). */
export function fps(page: Page, ms = 5000): Promise<number> {
  return page.evaluate(
    (t) =>
      new Promise<number>((resolve) => {
        let n = 0;
        const t0 = performance.now();
        const tick = () => {
          n++;
          if (performance.now() - t0 >= t) resolve((n * 1000) / (performance.now() - t0));
          else requestAnimationFrame(tick);
        };
        requestAnimationFrame(tick);
      }),
    ms,
  );
}

/** The graphics adapter Chromium is using (a GPU, or the software fallback). */
export function gpu(page: Page): Promise<string> {
  return page.evaluate(() => {
    const gl = document.createElement('canvas').getContext('webgl2')!;
    const ext = gl.getExtension('WEBGL_debug_renderer_info');
    return ext
      ? String(gl.getParameter(ext.UNMASKED_RENDERER_WEBGL))
      : String(gl.getParameter(gl.RENDERER));
  });
}

export const record = (name: string, data: unknown): void =>
  writeFileSync(join(OUT, `${name}.json`), JSON.stringify(data, null, 1));

/** Counts WebGL draw calls and triangles; read with `drawStats` (call before the page loads). */
export const COUNT_DRAWS = () => {
  const w = window as unknown as { __draws: { calls: number; tris: number } };
  w.__draws = { calls: 0, tris: 0 };
  for (const P of [WebGL2RenderingContext.prototype, WebGLRenderingContext.prototype]) {
    const wrap = (
      name: 'drawElements' | 'drawArrays' | 'drawElementsInstanced' | 'drawArraysInstanced',
    ) => {
      const orig = (P as unknown as Record<string, (...a: number[]) => void>)[name];
      if (!orig) return;
      (P as unknown as Record<string, unknown>)[name] = function (
        this: unknown,
        mode: number,
        a: number,
        b: number,
        c: number,
        d: number,
      ) {
        w.__draws.calls++;
        const count = name.startsWith('drawElements') ? b : b;
        const inst = name.endsWith('Instanced') ? (name === 'drawElementsInstanced' ? d : c) : 1;
        w.__draws.tris += (mode === 4 ? count / 3 : 0) * inst;
        return orig.call(this, mode, a, b, c, d);
      };
    };
    (
      ['drawElements', 'drawArrays', 'drawElementsInstanced', 'drawArraysInstanced'] as const
    ).forEach(wrap);
  }
};

/** Draw calls and triangles for `frames` rendered frames, averaged. */
export function drawStats(page: Page, frames = 30): Promise<{ calls: number; tris: number }> {
  return page.evaluate(
    (n) =>
      new Promise<{ calls: number; tris: number }>((resolve) => {
        const w = window as unknown as { __draws: { calls: number; tris: number } };
        w.__draws.calls = 0;
        w.__draws.tris = 0;
        let f = 0;
        const tick = () => {
          if (++f >= n)
            resolve({
              calls: Math.round(w.__draws.calls / n),
              tris: Math.round(w.__draws.tris / n),
            });
          else requestAnimationFrame(tick);
        };
        requestAnimationFrame(tick);
      }),
    frames,
  );
}

/** Builds the studio bundle in the page (Reference look when asked) and writes `scene.glb` + `sidecar.json` into `dir`. */
export async function saveStudioBundle(
  page: Page,
  dir: string,
  opts: { quality: string; reference: boolean },
): Promise<{ glbBytes: number; sidecar: Record<string, unknown> }> {
  mkdirSync(dir, { recursive: true });
  let body: Buffer | null = null;
  await page.route('**/__save-bundle', async (route) => {
    body = route.request().postDataBuffer();
    await route.fulfill({ status: 204 });
  });
  await page.evaluate(async (o) => {
    const s = (
      window as unknown as {
        __duplex: {
          studio: {
            applyReferenceLook: (q: string) => Record<string, unknown>;
            buildStudioBundle: (o: Record<string, unknown>) => Promise<unknown>;
            packBundle: (b: unknown) => Blob;
          };
        };
      }
    ).__duplex.studio;
    const options = o.reference ? s.applyReferenceLook(o.quality) : { quality: o.quality };
    await new Promise((r) => setTimeout(r, 6000)); // the view settles on the look
    const bundle = await s.buildStudioBundle(options);
    await fetch('/__save-bundle', { method: 'POST', body: s.packBundle(bundle) });
  }, opts);
  const buf = body as Buffer | null;
  if (!buf) throw new Error('the bundle was not produced');
  const n = buf.readUInt32LE(0);
  const sidecar = JSON.parse(buf.subarray(4, 4 + n).toString('utf8')) as Record<string, unknown>;
  const glb = buf.subarray(4 + n);
  writeFileSync(join(dir, 'scene.glb'), glb);
  writeFileSync(join(dir, 'sidecar.json'), JSON.stringify(sidecar, null, 1));
  return { glbBytes: glb.length, sidecar };
}

/** Builds the lighting-bake bundle (static geometry with lightmap UVs + lights) and writes it as scene.glb + sidecar.json + uv.bin. */
export async function saveBakeBundle(
  page: Page,
  dir: string,
  opts: { preset: string; quality: string },
): Promise<{ glbBytes: number }> {
  mkdirSync(dir, { recursive: true });
  let body: Buffer | null = null;
  await page.route('**/__save-bake', async (route) => {
    body = route.request().postDataBuffer();
    await route.fulfill({ status: 204 });
  });
  await page.evaluate(async (o) => {
    const s = (
      window as unknown as {
        __duplex: {
          studio: {
            buildBakeBundle: (o: Record<string, unknown>) => Promise<unknown>;
            packBakeBundle: (b: unknown) => Blob;
          };
        };
      }
    ).__duplex.studio;
    const bundle = await s.buildBakeBundle(o);
    await fetch('/__save-bake', { method: 'POST', body: s.packBakeBundle(bundle) });
  }, opts);
  const buf = body as Buffer | null;
  if (!buf) throw new Error('the bake bundle was not produced');
  const n = buf.readUInt32LE(0);
  const m = buf.readUInt32LE(4 + n);
  writeFileSync(join(dir, 'sidecar.json'), buf.subarray(4, 4 + n));
  writeFileSync(join(dir, 'uv.bin'), buf.subarray(8 + n, 8 + n + m));
  const glb = buf.subarray(8 + n + m);
  writeFileSync(join(dir, 'scene.glb'), glb);
  return { glbBytes: glb.length };
}

/** A Studio render (Blender) from the camera the 3D view has now (or the options' view); returns the result id. */
export async function studioRenderHere(
  page: Page,
  options: Record<string, unknown>,
): Promise<string> {
  return page.evaluate(async (o) => {
    const d = (
      window as unknown as {
        __duplex: {
          studio: {
            buildStudioBundle: (o: Record<string, unknown>) => Promise<unknown>;
            packBundle: (b: unknown) => Blob;
          };
        };
      }
    ).__duplex.studio;
    const bundle = await d.buildStudioBundle(o);
    const r = await fetch('/api/studio/render?quality=' + String(o.quality), {
      method: 'POST',
      body: d.packBundle(bundle),
    });
    const { id } = (await r.json()) as { id: string };
    for (;;) {
      await new Promise((res) => setTimeout(res, 1000));
      const j = (await (await fetch('/api/studio/jobs/' + id)).json()) as {
        status: string;
        error?: string;
      };
      if (j.status === 'error' || j.status === 'cancelled') throw new Error(j.error ?? j.status);
      if (j.status === 'done') return id;
    }
  }, options);
}
