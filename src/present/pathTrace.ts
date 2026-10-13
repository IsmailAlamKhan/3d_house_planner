import { Color, type Camera, type Scene, type WebGLRenderer } from 'three';

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
  try {
    scene.traverse((obj) => {
      if (obj.userData?.sky) {
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
    while (tracer.samples < o.target) {
      if (o.signal.aborted) return 'cancelled';
      tracer.renderSample();
      o.onProgress(Math.floor(tracer.samples));
      await frame();
    }
    tracer.renderSample();
    o.onProgress(Math.floor(tracer.samples));
    return 'done';
  } finally {
    console.warn = warn;
    scene.background = before.background;
    scene.environment = before.environment;
    for (const h of hidden) h.set(h.visible);
    // Keep the last image on the canvas until the caller has read it: dispose after a frame.
    const t = tracer;
    if (t) setTimeout(() => t.dispose(), 0);
  }
}
