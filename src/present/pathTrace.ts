import { Denoiser } from './denoise';
import {
  Color,
  type Camera,
  type Material,
  type Mesh,
  type Scene,
  type Texture,
  type WebGLRenderer,
} from 'three';

export interface PathTraceOptions {
  /** Stop after this many samples per pixel. */
  target: number;
  onProgress: (samples: number) => void;
  signal: AbortSignal;
  /** Sky colour used as the environment (the sky dome itself is hidden while tracing). */
  background: string;
}

const frame = () => new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));

/**
 * Progressively path-traces the scene into the renderer's canvas with three-gpu-pathtracer.
 * Resolves `'done'` (target reached), `'cancelled'` (the caller aborted; the canvas holds a partial image) or throws
 * when the GPU/driver cannot run it (the caller falls back to the normal render).
 */
export async function pathTraceInto(
  gl: WebGLRenderer,
  scene: Scene,
  camera: Camera,
  o: PathTraceOptions,
): Promise<'done' | 'cancelled'> {
  if (!gl.capabilities.isWebGL2) throw new Error('WebGL 2 is not available.');
  const { WebGLPathTracer } = await import('three-gpu-pathtracer');
  // The deprecation notice of the library is not useful to the user.
  const warn = console.warn;
  console.warn = (...a: unknown[]) => {
    if (typeof a[0] === 'string' && a[0].startsWith('WebGLPathTracer')) return;
    warn(...a);
  };
  const hidden: { visible: boolean; set: (v: boolean) => void }[] = [];
  const before = { background: scene.background, environment: scene.environment };
  let tracer: InstanceType<typeof WebGLPathTracer> | null = null;
  let denoiser: Denoiser | null = null;
  try {
    scene.traverse((obj) => {
      // The sky dome, and the invisible "shadow only" ceilings/roofs of a cutaway (colorWrite off): the tracer does not
      // know that flag and would draw them as solid black slabs over the rooms.
      const mat = (obj as Mesh).material as Material | undefined;
      if (obj.userData?.sky || (mat && !Array.isArray(mat) && mat.colorWrite === false)) {
        const was = obj.visible;
        obj.visible = false;
        hidden.push({ visible: was, set: (v) => (obj.visible = v) });
      }
    });
    scene.background = new Color(o.background);
    scene.environment = null;
    tracer = new WebGLPathTracer(gl);
    tracer.bounces = 4;
    tracer.renderDelay = 0;
    tracer.minSamples = 1;
    tracer.fadeDuration = 0;
    tracer.tiles.set(2, 2);
    tracer.setScene(scene, camera);
    // The last picture goes through the denoiser (fireflies and grain); the progressive preview stays raw and fast.
    const t = tracer;
    const finish = (): void => {
      const d = (denoiser = new Denoiser());
      t.renderToCanvasCallback = (target, renderer, quad) => {
        (quad.material as unknown as { map: Texture | null }).map = d.apply(renderer, target);
        const auto = renderer.autoClear;
        renderer.autoClear = false;
        quad.render(renderer);
        renderer.autoClear = auto;
      };
      t.renderSample();
      o.onProgress(Math.floor(t.samples));
    };
    while (t.samples < o.target) {
      if (o.signal.aborted) {
        finish();
        return 'cancelled';
      }
      t.renderSample();
      o.onProgress(Math.floor(t.samples));
      await frame();
    }
    finish();
    return 'done';
  } finally {
    console.warn = warn;
    scene.background = before.background;
    scene.environment = before.environment;
    for (const h of hidden) h.set(h.visible);
    // Keep the last image on the canvas until the caller has read it: dispose after a frame.
    const t = tracer;
    const d = denoiser as Denoiser | null;
    if (t) setTimeout(() => (t.dispose(), d?.dispose()), 0);
  }
}
