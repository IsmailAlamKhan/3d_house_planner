export type Quality = 'low' | 'medium' | 'high';
export type QualityChoice = 'auto' | Quality;

export type ShadowType = 'percentage' | 'soft' | 'variance';

/**
 * What each tier costs. The tiers differ in cost and fine detail only — never in overall brightness or colour: all of
 * them use the same colour pipeline (linear lighting, one exposure, AgX tone mapping applied once) and the same lights.
 */
export interface QualitySettings {
  /** Real-time shadows (the sun always casts them; hidden ceilings and roofs cast too). */
  shadows: boolean;
  /** Sun shadow-map size. */
  shadowMapSize: number;
  shadowType: ShadowType;
  /** Hardware multisampling for canvases that do not use the post-processing pipeline (snapshot viewer, comparison). */
  antialias: boolean;
  /** Pixel-ratio range handed to the renderer: [min, max]. */
  dpr: [number, number];
  /** Ambient occlusion in world units (N8AO): none / half-resolution / full resolution. */
  ao: 'none' | 'half' | 'full';
  /** Anti-aliasing in the post-processing pipeline. */
  aa: 'fxaa' | 'smaa';
  /** Subtle bloom on emissive surfaces. */
  bloom: boolean;
  /** Most point / spot lights that emit at once; the rest only glow. */
  maxLights: number;
  /** Of those, how many (the nearest) cast shadows, besides the sun. */
  shadowLights: number;
  /** Image-based light from a locally generated environment map (reflections and a little fill). */
  environment: boolean;
  /** Cheap soft blobs under furniture instead of ambient occlusion. */
  blobShadows: boolean;
  /** Most window skylights (area lights) in realistic lighting. */
  maxWindowLights: number;
}

export const QUALITY: Record<Quality, QualitySettings> = {
  low: {
    shadows: true,
    shadowMapSize: 1024,
    shadowType: 'percentage',
    antialias: false,
    dpr: [1, 1],
    ao: 'none',
    aa: 'fxaa',
    bloom: false,
    maxLights: 8,
    shadowLights: 0,
    environment: true,
    blobShadows: true,
    maxWindowLights: 6,
  },
  medium: {
    shadows: true,
    shadowMapSize: 2048,
    shadowType: 'soft',
    antialias: true,
    dpr: [1, 1.5],
    ao: 'half',
    aa: 'smaa',
    bloom: true,
    maxLights: 16,
    shadowLights: 2,
    environment: true,
    blobShadows: false,
    maxWindowLights: 10,
  },
  high: {
    shadows: true,
    shadowMapSize: 4096,
    shadowType: 'soft',
    antialias: true,
    dpr: [1, 2],
    ao: 'full',
    aa: 'smaa',
    bloom: true,
    maxLights: 32,
    shadowLights: 4,
    environment: true,
    blobShadows: false,
    maxWindowLights: 14,
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
