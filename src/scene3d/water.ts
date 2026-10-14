import {
  DataTexture,
  LinearFilter,
  LinearMipmapLinearFilter,
  type MeshStandardMaterial,
  RepeatWrapping,
  RGBAFormat,
  Vector2,
} from 'three';

/**
 * Pool and pond water: a tileable ripple normal map that drifts over the surface (two crossing waves, so it never slides
 * in one direction), a very smooth surface and a faint cyan glow from the lit tiles below. One small texture and one
 * time value are shared by every water surface, so it costs nothing per pool.
 */
const SIZE = 128;
let ripples: DataTexture | undefined;

function rippleMap(): DataTexture {
  if (ripples) return ripples;
  const data = new Uint8Array(SIZE * SIZE * 4);
  const tau = Math.PI * 2;
  // height = sum of sines whose frequencies are whole numbers per tile, so the map repeats without seams
  const waves = [
    [3, 1, 0.5],
    [-2, 4, 0.35],
    [5, 3, 0.2],
    [1, -6, 0.15],
  ] as const;
  const h = (x: number, y: number) =>
    waves.reduce((s, [fx, fy, a]) => s + a * Math.sin((tau * (fx * x + fy * y)) / SIZE), 0);
  for (let y = 0; y < SIZE; y++)
    for (let x = 0; x < SIZE; x++) {
      const dx = (h(x + 1, y) - h(x - 1, y)) * 6;
      const dy = (h(x, y + 1) - h(x, y - 1)) * 6;
      const len = Math.hypot(dx, dy, 1);
      const i = (y * SIZE + x) * 4;
      data[i] = Math.round(((-dx / len) * 0.5 + 0.5) * 255);
      data[i + 1] = Math.round(((-dy / len) * 0.5 + 0.5) * 255);
      data[i + 2] = Math.round(((1 / len) * 0.5 + 0.5) * 255);
      data[i + 3] = 255;
    }
  const t = new DataTexture(data, SIZE, SIZE, RGBAFormat);
  t.wrapS = t.wrapT = RepeatWrapping;
  t.magFilter = LinearFilter;
  t.minFilter = LinearMipmapLinearFilter;
  t.generateMipmaps = true;
  t.repeat.set(0.5, 0.5);
  t.needsUpdate = true;
  ripples = t;
  return t;
}

/** Gives a water material its moving ripples and glow. */
export function styleWater(m: MeshStandardMaterial): void {
  m.normalMap = rippleMap();
  m.normalScale = new Vector2(0.35, 0.35);
  m.roughness = 0.04;
  m.emissive.set('#0891b2');
  m.emissiveIntensity = 0.22;
}

/** Moves the ripples; call once per frame with the elapsed time in seconds. */
export function tickWater(seconds: number): void {
  if (!ripples) return;
  ripples.offset.set(seconds * 0.021, Math.sin(seconds * 0.35) * 0.06 + seconds * 0.013);
}
