import { type BufferGeometry, Matrix4 } from 'three';
import { describeCamera } from '../export/bridge';
import { exportGlb } from '../export/model3d';
import { useModel } from '../model/store';
import type { Project } from '../model/types';
import { type AnyPart, isObjectPart } from '../scene3d/generators/common';
import { DEFAULT_CUT_HEIGHT, SceneBuilder } from '../scene3d/sceneModel';
import { environmentFor } from '../studio/bundle';
import { studioLamps, studioWindows } from '../studio/lamps';
import { REFERENCE_KELVIN } from '../studio/referenceLook';
import { type AtlasMeshIn, buildLightmapAtlas, geometryHash, withUv1 } from './atlas';
import { bakeKey, lightingForPreset } from './bakeKey';
import {
  BAKE_DENSITY,
  type BakePart,
  type BakePreset,
  type BakeQuality,
  type BakeSidecar,
  BakeSidecarSchema,
} from './protocol';

/** Layers whose surfaces are lit by the bake (they never move). Furniture, glass and water are not. */
const STATIC_LAYERS = new Set([
  'wall',
  'slab',
  'floor',
  'ceiling',
  'roof',
  'column',
  'stair',
  'site',
]);
/** The huge ground beyond the plot is not worth texels. */
const SKIP_IDS = new Set(['site:surround']);

export interface BakeBundle {
  glb: ArrayBuffer;
  sidecar: BakeSidecar;
  /** Lightmap UVs of the baked parts, Float32, in the order of `sidecar.bake.parts`. */
  uv: ArrayBuffer;
  /** The revision this bake is made for. */
  key: string;
  atlas: { width: number; height: number; texelsPerMetre: number };
}

/** The meshes that get a lightmap: static surfaces with an ordinary opaque material. */
export function staticBakeMeshes(project: Project): AtlasMeshIn[] {
  const builder = new SceneBuilder();
  try {
    const levels = builder.build(project, {
      wallMode: 'up',
      cutHeight: DEFAULT_CUT_HEIGHT,
      doorsOpen: true,
    });
    const out: AtlasMeshIn[] = [];
    const add = (parts: readonly AnyPart[]) => {
      for (const p of parts) {
        if (isObjectPart(p) || SKIP_IDS.has(p.id) || !STATIC_LAYERS.has(p.layer)) continue;
        if (p.materials.some((m) => m === 'glass' || m === 'water')) continue;
        // a copy: the builder (and its geometries) is disposed below
        out.push({ id: p.id, geometry: p.geometry.clone() });
      }
    };
    for (const l of levels) add(l.parts);
    add(levels.site);
    return out;
  } finally {
    builder.dispose();
  }
}

/** A camera for the sidecar (the bake has no picture to take): the live one, or one looking down from above. */
function anyCamera(): BakeSidecar['camera'] {
  const live = describeCamera();
  if (live)
    return {
      matrixWorld: live.matrixWorld,
      kind: live.kind,
      fov: live.fov,
      orthoHeight: live.orthoHeight,
      near: live.near,
      far: live.far,
    };
  return {
    matrixWorld: new Matrix4().makeTranslation(0, 30, 0).toArray(),
    kind: 'perspective',
    fov: 45,
    near: 0.1,
    far: 800,
  };
}

/**
 * The bake bundle: the building's static geometry as a glb with a second UV set (the lightmap atlas), the lights and the
 * sky of the lighting preset (the "Reference look" light for dusk: warm 2700 K and the soft accent lights), and the list of
 * parts with their vertex counts and shape hashes. Furniture is left out: it moves.
 */
export async function buildBakeBundle(o: {
  preset: BakePreset;
  quality: BakeQuality;
}): Promise<BakeBundle> {
  const project = useModel.getState().project;
  const lighting = lightingForPreset(o.preset);
  const density = BAKE_DENSITY[o.quality];

  const meshes = staticBakeMeshes(project);
  if (!meshes.length) throw new Error('There is nothing to bake yet.');
  const atlas = buildLightmapAtlas(meshes, { texelsPerMetre: density.texelsPerMetre });

  const lightmap = new Map<string, BufferGeometry>();
  const parts: BakePart[] = [];
  const chunks: Float32Array[] = [];
  for (const m of meshes) {
    const uv1 = atlas.uv1.get(m.id)!;
    const g = withUv1(m.geometry, uv1);
    lightmap.set(m.id, g);
    parts.push({
      id: m.id,
      vertexCount: g.getAttribute('position').count,
      hash: geometryHash(m.geometry),
    });
    chunks.push(uv1);
  }
  const uv = new Float32Array(chunks.reduce((n, c) => n + c.length, 0));
  let at = 0;
  for (const c of chunks) {
    uv.set(c, at);
    at += c.length;
  }

  const glb = await exportGlb(project, { meta: true, skipItems: true, lightmap });
  for (const m of meshes) m.geometry.dispose();
  for (const g of lightmap.values()) g.dispose();

  const dusk = o.preset === 'dusk';
  const sidecar = BakeSidecarSchema.parse({
    version: 1,
    projectId: project.id,
    projectName: project.name,
    look: `bake-${o.preset}`,
    output: { width: 256, height: 256 },
    camera: anyCamera(),
    environment: environmentFor(lighting, project.settings.compass, 0),
    cutaway: { enabled: false },
    lights: {
      lamps: studioLamps(project, lighting, {
        accent: dusk,
        kelvin: dusk ? REFERENCE_KELVIN : undefined,
      }),
      windows: studioWindows(project),
    },
    glare: false,
    bake: {
      preset: o.preset,
      atlasWidth: atlas.width,
      atlasHeight: atlas.height,
      parts,
    },
  });
  return {
    glb,
    sidecar,
    uv: uv.buffer,
    key: bakeKey(project, o.preset),
    atlas: { width: atlas.width, height: atlas.height, texelsPerMetre: atlas.texelsPerMetre },
  };
}

/** One request body: sidecar length (u32 LE), the sidecar JSON, the uv length (u32 LE), the uv bytes, then the glb. */
export function packBakeBundle(b: BakeBundle): Blob {
  const json = new TextEncoder().encode(JSON.stringify(b.sidecar));
  const head = new Uint8Array(4);
  new DataView(head.buffer).setUint32(0, json.length, true);
  const mid = new Uint8Array(4);
  new DataView(mid.buffer).setUint32(0, b.uv.byteLength, true);
  return new Blob([head, json, mid, b.uv, b.glb], { type: 'application/octet-stream' });
}
