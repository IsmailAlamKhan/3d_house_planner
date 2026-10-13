import { type Color, type Material, ShaderChunk } from 'three';

/**
 * Sky light that only reaches the outdoors.
 *
 * three.js hemisphere lights and the environment map light every surface the same, whether it is under a roof or not,
 * which makes rooms glow with no lamp on. Instead each material multiplies those two contributions by `uSkyMix`:
 * outdoor materials (ground, exterior faces, roofs, garden furniture) keep 1, indoor ones share one uniform that is the
 * "night visibility" in realistic lighting and 1 in design lighting. Direct light (sun, lamps, window lights) is
 * untouched, and the sun is shadowed by every ceiling and roof (even hidden ones).
 */
const indoorSky = { value: 1 };

/** Sets the indoor share of sky and environment light: 1 = design lighting, ~0.02 = realistic "night visibility". */
export function setIndoorSky(value: number): void {
  indoorSky.value = Math.min(1, Math.max(0, value));
}
export const getIndoorSky = (): number => indoorSky.value;

const BEGIN = ShaderChunk.lights_fragment_begin.replace(
  'irradiance += getHemisphereLightIrradiance( hemisphereLights[ i ], geometryNormal );',
  'irradiance += getHemisphereLightIrradiance( hemisphereLights[ i ], geometryNormal ) * uSkyMix;',
);
const MAPS = ShaderChunk.lights_fragment_maps
  .replace(
    'iblIrradiance += getIBLIrradiance( geometryNormal );',
    'iblIrradiance += getIBLIrradiance( geometryNormal ) * uSkyMix;',
  )
  .replace('radiance += iblRadiance;', 'radiance += iblRadiance * uSkyMix;');

const patched = new WeakSet<Material>();

/** Makes a standard material take part in the sky mix. `outdoor` materials always get the full sky. */
export function applySkyMix<T extends Material>(material: T, outdoor = false): T {
  if (patched.has(material)) return material;
  patched.add(material);
  const own = { value: 1 };
  const previous = material.onBeforeCompile;
  material.onBeforeCompile = (shader, renderer) => {
    previous?.call(material, shader, renderer);
    shader.uniforms.uSkyMix = outdoor ? own : indoorSky;
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform float uSkyMix;')
      .replace('#include <lights_fragment_begin>', BEGIN)
      .replace('#include <lights_fragment_maps>', MAPS);
  };
  material.customProgramCacheKey = () => 'skymix';
  material.needsUpdate = true;
  return material;
}

/** Whites are capped (no surface reflects 100 %): keeps white sofas visible against white walls. */
export const MAX_ALBEDO = 0.88;

/** Caps the linear albedo of a colour in place. */
export function capAlbedo(color: Color): Color {
  color.r = Math.min(color.r, MAX_ALBEDO);
  color.g = Math.min(color.g, MAX_ALBEDO);
  color.b = Math.min(color.b, MAX_ALBEDO);
  return color;
}
