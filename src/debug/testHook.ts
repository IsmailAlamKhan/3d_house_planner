import { captureScene } from '../export/bridge';
import { buildBakeBundle, packBakeBundle } from '../bake/bundle';
import { captureEnhanceInputs } from '../render/enhance';
import { useBake } from '../bake/bakeStore';
import { bakeStats, setBakeGain } from '../bake/runtime';
import { buildStudioBundle, packBundle } from '../studio/bundle';
import { applyReferenceLook } from '../studio/referenceLook';
import { withScene } from '../export/scene';
import { useModel } from '../model/store';
import { getLabelFrame } from '../present/labelFrame';
import { usePresent } from '../present/presentStore';
import { useCamera } from '../scene3d/camera/cameraStore';
import { useSceneStore } from '../scene3d/sceneStore';
import { Matrix4, Vector3 } from 'three';

export interface Rect {
  /** Normalised picture coordinates, 0–1, origin top-left. */
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

async function decode(blob: Blob): Promise<ImageData> {
  const bmp = await createImageBitmap(blob);
  const c = document.createElement('canvas');
  c.width = bmp.width;
  c.height = bmp.height;
  const ctx = c.getContext('2d', { willReadFrequently: true })!;
  ctx.drawImage(bmp, 0, 0);
  return ctx.getImageData(0, 0, c.width, c.height);
}

/** Display luminance (0–1, Rec. 709 weights on the sRGB values) of each rectangle of the rendered picture. */
export async function measureLuminance(rects: Record<string, Rect> = {}): Promise<{
  mean: number;
  rects: Record<string, number>;
  width: number;
  height: number;
}> {
  const shot = await withScene(() =>
    captureScene({ scale: 1, format: 'png', transparent: false, presentation: true, fx: true }),
  );
  const img = await decode(shot.blob);
  const lum = (x0: number, y0: number, x1: number, y1: number) => {
    let sum = 0;
    let n = 0;
    const xa = Math.max(0, Math.floor(x0 * img.width));
    const xb = Math.min(img.width, Math.ceil(x1 * img.width));
    const ya = Math.max(0, Math.floor(y0 * img.height));
    const yb = Math.min(img.height, Math.ceil(y1 * img.height));
    for (let y = ya; y < yb; y++)
      for (let x = xa; x < xb; x++) {
        const i = (y * img.width + x) * 4;
        sum +=
          (0.2126 * img.data[i]! + 0.7152 * img.data[i + 1]! + 0.0722 * img.data[i + 2]!) / 255;
        n++;
      }
    return n ? sum / n : 0;
  };
  const out: Record<string, number> = {};
  for (const [k, r] of Object.entries(rects)) out[k] = lum(r.x0, r.y0, r.x1, r.y1);
  return { mean: lum(0, 0, 1, 1), rects: out, width: img.width, height: img.height };
}

/** Where a world point (metres) is in the 3D picture (normalised 0–1, origin top-left); null if there is no frame yet. */
export function worldToScreen(x: number, y: number, z: number): { x: number; y: number } | null {
  const f = getLabelFrame();
  if (!f) return null;
  const v = new Vector3(x, y, z).applyMatrix4(new Matrix4().fromArray(f.viewProjection));
  return { x: (v.x + 1) / 2, y: (1 - v.y) / 2 };
}

/** The test hook: only for end-to-end and visual tests (never used by the app itself). */
/** A clean picture of the 3D view as it is now (no toolbars), as a base64 PNG. */
async function captureView(): Promise<string> {
  const shot = await withScene(() =>
    captureScene({ scale: 1, format: 'png', transparent: false, presentation: true, fx: true }),
  );
  const buf = new Uint8Array(await shot.blob.arrayBuffer());
  let s = '';
  for (let i = 0; i < buf.length; i += 0x8000)
    s += String.fromCharCode(...buf.subarray(i, i + 0x8000));
  return btoa(s);
}

export function installTestHook(): void {
  Object.assign((window as unknown as { __duplex: object }).__duplex, {
    stores: {
      model: useModel,
      scene: useSceneStore,
      camera: useCamera,
      present: usePresent,
      bake: useBake,
    },
    measureLuminance,
    captureView,
    captureEnhanceInputs,
    setBakeGain,
    bakeStats,
    worldToScreen,
    studio: { buildStudioBundle, packBundle, applyReferenceLook, buildBakeBundle, packBakeBundle },
  });
}
