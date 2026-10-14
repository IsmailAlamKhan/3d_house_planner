import {
  BufferAttribute,
  type BufferGeometry,
  type Material,
  type MeshStandardMaterial,
  ShaderChunk,
  type Texture,
  Vector3,
} from 'three';
import type { Part } from '../scene3d/generators/common';
import { deindex, geometryHash } from './atlas';
import { useBake } from './bakeStore';

/**
 * Baked lighting in the 3D view. A part that was baked (same id, same shape) is drawn with its lightmap: the lightmap holds
 * the diffuse light that reaches the surface (direct, bounced, shadowed, as Blender worked it out), the material ignores the
 * real-time lights and shows `albedo × lightmap` plus reflections of the environment. Everything else (furniture, parts that
 * changed since the bake) keeps real-time lighting.
 */

/** Overall brightness of the lightmap against the real-time lights (the exposure slider still applies on top). */
export const BAKE_GAIN = 0.42;

const geometries = new WeakMap<BufferGeometry, { applied: object; geo: BufferGeometry | null }>();
const hashes = new WeakMap<BufferGeometry, string>();

/** Counts of what happened to the parts drawn since the bake was loaded (for the GPU specs and debugging). */
export const bakeStats = {
  parts: 0,
  baked: 0,
  notInBake: 0,
  changed: 0,
  missing: [] as string[],
  probes: 0,
  withProbe: 0,
};

/** The part's geometry with the lightmap UV set, or null when the part has no valid bake (not baked, or its shape changed). */
export function bakedGeometry(part: Part): BufferGeometry | null {
  const applied = useBake.getState().applied;
  if (!applied) return null;
  const hit = geometries.get(part.geometry);
  if (hit && hit.applied === applied) return hit.geo;
  let geo: BufferGeometry | null = null;
  const baked = applied.parts.get(part.id);
  bakeStats.parts++;
  if (!baked) {
    bakeStats.notInBake++;
    if (bakeStats.missing.length < 8) bakeStats.missing.push(part.id);
  }
  if (baked) {
    let h = hashes.get(part.geometry);
    if (!h) hashes.set(part.geometry, (h = geometryHash(part.geometry)));
    const tris = (part.geometry.index?.count ?? part.geometry.getAttribute('position').count) / 3;
    if (h === baked.hash && tris * 3 === baked.vertexCount) {
      geo = deindex(part.geometry);
      geo.setAttribute('uv1', new BufferAttribute(baked.uv1, 2));
      bakeStats.baked++;
    } else bakeStats.changed++;
  }
  geometries.set(part.geometry, { applied, geo });
  return geo;
}

/** A reflection probe: what a level looks like from its middle, with the box of the level for parallax correction. */
export interface Probe {
  texture: Texture;
  position: Vector3;
  min: Vector3;
  max: Vector3;
}

interface Patched {
  material: MeshStandardMaterial;
  levelId: string;
  uniforms: {
    uProbePos: { value: Vector3 };
    uBoxMin: { value: Vector3 };
    uBoxMax: { value: Vector3 };
    uBoxOn: { value: number };
    uReflect: { value: number };
  };
}
const patched = new Map<string, Patched>();
const probes = new Map<string, Probe>();

/** The probe a level's surfaces reflect (the ground level's for the plot). */
const probeFor = (levelId: string): Probe | undefined =>
  probes.get(levelId) ?? probes.get('ground');

function applyProbe(p: Patched): void {
  const probe = probeFor(p.levelId);
  p.material.envMap = probe?.texture ?? null;
  p.uniforms.uBoxOn.value = probe ? 1 : 0;
  if (probe) {
    p.uniforms.uProbePos.value.copy(probe.position);
    p.uniforms.uBoxMin.value.copy(probe.min);
    p.uniforms.uBoxMax.value.copy(probe.max);
  }
  p.material.needsUpdate = true;
}

/** Hands the rendered probes over; surfaces already drawn pick them up. */
export function setProbes(next: Map<string, Probe>): void {
  for (const old of probes.values()) if (![...next.values()].includes(old)) old.texture.dispose();
  probes.clear();
  for (const [k, v] of next) probes.set(k, v);
  for (const p of patched.values()) applyProbe(p);
  bakeStats.probes = probes.size;
  bakeStats.withProbe = [...patched.values()].filter((p) => p.material.envMap).length;
}

const NL = '\n';
const BOX_PROJECT = `
  varying vec3 vBoxWorld;
  uniform vec3 uProbePos;
  uniform vec3 uBoxMin;
  uniform vec3 uBoxMax;
  uniform float uBoxOn;
  uniform float uReflect;
  // parallax-corrected reflection: where the reflected ray leaves the probe's box, seen from the probe's middle
  vec3 boxProject( vec3 dir ) {
    if ( uBoxOn < 0.5 ) return dir;
    vec3 safe = vec3( abs( dir.x ) < 1e-5 ? 1e-5 : dir.x, abs( dir.y ) < 1e-5 ? 1e-5 : dir.y, abs( dir.z ) < 1e-5 ? 1e-5 : dir.z );
    vec3 t1 = ( uBoxMax - vBoxWorld ) / safe;
    vec3 t2 = ( uBoxMin - vBoxWorld ) / safe;
    vec3 tf = max( t1, t2 );
    float d = max( min( min( tf.x, tf.y ), tf.z ), 0.0 );
    return normalize( vBoxWorld + dir * d - uProbePos );
  }
`;

/**
 * Stops the real-time lights from touching a surface (direct light, ambient and hemisphere): only its lightmap and
 * reflections remain. Reflections come from the level's probe, box-projected.
 */
function bakedShader(m: MeshStandardMaterial, uniforms: Patched['uniforms']): void {
  m.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>${NL}varying vec3 vBoxWorld;`)
      .replace(
        '#include <project_vertex>',
        `#include <project_vertex>${NL}vBoxWorld = ( modelMatrix * vec4( transformed, 1.0 ) ).xyz;`,
      );
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>${NL}${BOX_PROJECT}`)
      .replace(
        '#include <envmap_physical_pars_fragment>',
        ShaderChunk.envmap_physical_pars_fragment
          .replace(
            'reflectVec = transformDirectionByInverseViewMatrix( reflectVec, viewMatrix );',
            `reflectVec = transformDirectionByInverseViewMatrix( reflectVec, viewMatrix );${NL}reflectVec = boxProject( reflectVec );`,
          )
          .replace(
            'return envMapColor.rgb * envMapIntensity;',
            'return envMapColor.rgb * envMapIntensity * uReflect;',
          ),
      )
      .replace(
        '#include <lights_fragment_maps>',
        `reflectedLight.directDiffuse = vec3( 0.0 );
         reflectedLight.directSpecular = vec3( 0.0 );
         irradiance = vec3( 0.0 );
         #include <lights_fragment_maps>
         // the environment keeps its reflections but gives no diffuse light: the lightmap already holds the sky's
         iblIrradiance = vec3( 0.0 );`,
      );
  };
  m.customProgramCacheKey = () => 'baked-lightmap-v3';
}

/** The material of a baked part: the same surface, lit by the lightmap and reflecting its level's probe. Cached per material, level and bake. */
export function bakedMaterial(base: Material, levelId = 'ground'): Material {
  const applied = useBake.getState().applied;
  if (!applied || !(base as MeshStandardMaterial).isMeshStandardMaterial || base.transparent)
    return base;
  const k = `${base.uuid}|${levelId}|${applied.key}|${applied.preset}`;
  let p = patched.get(k);
  if (!p) {
    const m = (base as MeshStandardMaterial).clone();
    m.lightMap = applied.texture;
    // three treats the lightmap as irradiance: its albedo-weighted result is albedo / π × irradiance, and Cycles' diffuse
    // bake gives radiance for albedo 1, hence the π
    m.lightMapIntensity = Math.PI * applied.scale * BAKE_GAIN * useBake.getState().gain;
    const uniforms = {
      uProbePos: { value: new Vector3() },
      uBoxMin: { value: new Vector3() },
      uBoxMax: { value: new Vector3() },
      uBoxOn: { value: 0 },
      uReflect: { value: useBake.getState().reflect },
    };
    bakedShader(m, uniforms);
    p = { material: m, levelId, uniforms };
    patched.set(k, p);
    applyProbe(p);
  }
  return p.material;
}

/** Changes the brightness of the lightmap on screen at once (surfaces already drawn included). */
export function setBakeGain(gain: number, reflect = useBake.getState().reflect): void {
  useBake.setState({ gain, reflect });
  const applied = useBake.getState().applied;
  if (!applied) return;
  for (const p of patched.values()) {
    p.material.lightMapIntensity = Math.PI * applied.scale * BAKE_GAIN * gain;
    p.uniforms.uReflect.value = reflect;
  }
}

/** Forget the patched materials (the bake changed). */
export function clearBakedMaterials(): void {
  for (const p of patched.values()) p.material.dispose();
  patched.clear();
}
