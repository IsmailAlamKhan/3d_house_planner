export type Quality = 'low' | 'medium' | 'high';
export type QualityChoice = 'auto' | Quality;

export interface QualitySettings {
  /** Real-time shadows from the sun. */
  shadows: boolean;
  shadowMapSize: number;
  antialias: boolean;
  /** Pixel-ratio range handed to the renderer: [min, max]. */
  dpr: [number, number];
  /** Screen-space ambient occlusion (High only). */
  ao: boolean;
  /** Most interior lamps that emit light at once. */
  maxLights: number;
  /** Of those, how many cast shadows. */
  shadowLights: number;
  /** Image-based light from a locally generated environment map. */
  environment: boolean;
}

export const QUALITY: Record<Quality, QualitySettings> = {
  low: {
    shadows: false,
    shadowMapSize: 512,
    antialias: false,
    dpr: [1, 1],
    ao: false,
    maxLights: 4,
    shadowLights: 0,
    environment: false,
  },
  medium: {
    shadows: true,
    shadowMapSize: 1024,
    antialias: true,
    dpr: [1, 1.5],
    ao: false,
    maxLights: 8,
    shadowLights: 0,
    environment: true,
  },
  high: {
    shadows: true,
    shadowMapSize: 2048,
    antialias: true,
    dpr: [1, 2],
    ao: true,
    maxLights: 12,
    shadowLights: 2,
    environment: true,
  },
};

export interface DeviceInfo {
  cores: number;
  /** navigator.deviceMemory (GB), when the browser reports it. */
  memory?: number;
  /** GPU description from WEBGL_debug_renderer_info ("" if unavailable). */
  renderer: string;
  touch: boolean;
  /** Smaller side of the screen in CSS pixels. */
  screenMin: number;
}

/** Picks a quality level from what we can learn about the device. */
export function detectQuality(d: DeviceInfo): Quality {
  const gpu = d.renderer.toLowerCase();
  if (/swiftshader|llvmpipe|software|softpipe/.test(gpu)) return 'low';
  if (d.touch && d.screenMin < 900) return 'low';
  if ((d.memory ?? 8) <= 2 || d.cores <= 2) return 'low';
  if (/apple/.test(gpu)) return d.cores >= 8 ? 'high' : 'medium';
  if (/nvidia|geforce|rtx|gtx|radeon rx|radeon pro|amd radeon\(tm\) (rx|pro)/.test(gpu))
    return 'high';
  if (/intel|mali|adreno|powervr|vega|radeon\(tm\) graphics/.test(gpu)) return 'medium';
  return d.cores >= 8 ? 'medium' : 'low';
}

let cached: Quality | undefined;

/** Reads the device once (creates a throwaway WebGL context to learn the GPU name). */
export function autoQuality(): Quality {
  if (cached) return cached;
  let renderer = '';
  try {
    const gl = document.createElement('canvas').getContext('webgl');
    const ext = gl?.getExtension('WEBGL_debug_renderer_info');
    if (gl && ext) renderer = String(gl.getParameter(ext.UNMASKED_RENDERER_WEBGL));
    gl?.getExtension('WEBGL_lose_context')?.loseContext();
  } catch {
    renderer = '';
  }
  const nav = navigator as Navigator & { deviceMemory?: number };
  cached = detectQuality({
    cores: nav.hardwareConcurrency ?? 4,
    memory: nav.deviceMemory,
    renderer,
    touch: 'ontouchstart' in window || nav.maxTouchPoints > 0,
    screenMin: Math.min(window.screen.width, window.screen.height),
  });
  return cached;
}

export const resolveQuality = (choice: QualityChoice): Quality =>
  choice === 'auto' ? autoQuality() : choice;
