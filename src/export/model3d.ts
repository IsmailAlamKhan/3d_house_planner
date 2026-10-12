import {
  type BufferGeometry,
  DoubleSide,
  Group,
  Mesh,
  MeshStandardMaterial,
  type Material,
  Vector3,
} from 'three';
import { GLTFExporter } from 'three/examples/jsm/exporters/GLTFExporter.js';
import { resolveMaterial } from '../materials';
import type { Project } from '../model/types';
import { type AnyPart, isObjectPart } from '../scene3d/generators/common';
import { getMaterial } from '../scene3d/materials3d';
import { prepareObject } from '../scene3d/objectView';
import { DEFAULT_CUT_HEIGHT, SceneBuilder } from '../scene3d/sceneModel';

export interface Model3dOptions {
  /** Only this level (its own geometry, at its real elevation). */
  levelId?: string;
  /** Use the procedural textures (needs a browser canvas). Off = flat colours, which also works without a DOM. */
  textures?: boolean;
}

/** Plain colour material for a material key (no texture), for exports that cannot carry textures. */
function flatMaterial(key: string, overrides: Project['materials']): MeshStandardMaterial {
  const spec = resolveMaterial(key, overrides);
  return new MeshStandardMaterial({
    color: spec.color,
    roughness: spec.roughness,
    metalness: spec.metalness,
    transparent: spec.opacity < 1,
    opacity: spec.opacity,
    side: key === 'glass' ? DoubleSide : undefined,
    name: key,
  });
}

/**
 * The whole building (or one level) as a three.js group in metres, y up, plan (x, y) → world (x, h, y) — the same
 * frame the editor uses — ready for GLTFExporter or the OBJ writer. Geometry is built fresh and owned by the group.
 */
export function buildExportGroup(
  project: Project,
  opts: Model3dOptions = {},
): { group: Group; dispose: () => void } {
  const builder = new SceneBuilder();
  const levels = builder.build(project, {
    wallMode: 'up',
    cutHeight: DEFAULT_CUT_HEIGHT,
    doorsOpen: true,
  });
  const group = new Group();
  group.name = project.name;
  const flats = new Map<string, MeshStandardMaterial>();
  const material = (key: string): Material =>
    opts.textures === false
      ? (flats.get(key) ?? flats.set(key, flatMaterial(key, project.materials)).get(key)!)
      : getMaterial(key, project.materials);

  for (const { level, parts } of levels) {
    if (opts.levelId && level.id !== opts.levelId) continue;
    const g = new Group();
    g.name = level.name;
    g.position.y = level.elevation;
    for (const part of parts as AnyPart[]) {
      if (isObjectPart(part)) {
        const o = prepareObject(part.object, { highlight: false });
        o.name = part.id;
        g.add(o);
        continue;
      }
      const mats = part.materials.map(material);
      const mesh = new Mesh(part.geometry, mats.length === 1 ? mats[0]! : mats);
      mesh.name = part.id;
      g.add(mesh);
    }
    group.add(g);
  }
  return {
    group,
    dispose: () => {
      builder.dispose();
      for (const m of flats.values()) m.dispose();
    },
  };
}

/** Binary glTF (.glb) with materials; resolves to the file bytes. */
export async function exportGlb(project: Project, opts: Model3dOptions = {}): Promise<ArrayBuffer> {
  const { group, dispose } = buildExportGroup(project, opts);
  try {
    group.updateMatrixWorld(true);
    const result = await new GLTFExporter().parseAsync(group, { binary: true, onlyVisible: true });
    return result as ArrayBuffer;
  } finally {
    dispose();
  }
}

const f = (v: number) => (Math.round(v * 1e5) / 1e5).toString();

/** A material's `newmtl` block. */
function mtlBlock(name: string, m: Material): string {
  const std = m as MeshStandardMaterial;
  const c = std.color ?? { r: 0.8, g: 0.8, b: 0.8 };
  return [
    `newmtl ${name}`,
    `Kd ${f(c.r)} ${f(c.g)} ${f(c.b)}`,
    `Ka 0 0 0`,
    `Ks 0.1 0.1 0.1`,
    `d ${f(std.opacity ?? 1)}`,
    `illum 2`,
    '',
  ].join('\n');
}

const safeName = (s: string) => s.replace(/[^A-Za-z0-9_.-]+/g, '_');

/** Wavefront OBJ plus its MTL (flat colours). Geometry is in world metres (y up). */
export function exportObj(
  project: Project,
  opts: Model3dOptions = {},
): { obj: string; mtl: string; mtlName: string } {
  const { group, dispose } = buildExportGroup(project, { ...opts, textures: false });
  const mtlName = `${safeName(project.name) || 'home'}.mtl`;
  try {
    group.updateMatrixWorld(true);
    const out: string[] = [`# ${project.name}`, `mtllib ${mtlName}`];
    const mtls = new Map<string, string>();
    let vBase = 1;
    let vtBase = 1;
    let vnBase = 1;
    group.traverse((obj) => {
      if (!(obj instanceof Mesh)) return;
      const geo = obj.geometry as BufferGeometry;
      const pos = geo.getAttribute('position');
      if (!pos) return;
      const nor = geo.getAttribute('normal');
      const uv = geo.getAttribute('uv');
      const mats = Array.isArray(obj.material) ? obj.material : [obj.material];
      out.push(`o ${safeName(obj.name) || 'mesh'}`);
      const v = new Vector3();
      for (let i = 0; i < pos.count; i++) {
        v.set(pos.getX(i), pos.getY(i), pos.getZ(i));
        const p = obj.localToWorld(v);
        out.push(`v ${f(p.x)} ${f(p.y)} ${f(p.z)}`);
      }
      if (uv) for (let i = 0; i < uv.count; i++) out.push(`vt ${f(uv.getX(i))} ${f(uv.getY(i))}`);
      if (nor) {
        const normalMatrix = obj.matrixWorld.clone();
        for (let i = 0; i < nor.count; i++) {
          const n = new Vector3(nor.getX(i), nor.getY(i), nor.getZ(i)).transformDirection(
            normalMatrix,
          );
          out.push(`vn ${f(n.x)} ${f(n.y)} ${f(n.z)}`);
        }
      }
      const idx = geo.getIndex();
      const triCount = idx ? idx.count / 3 : pos.count / 3;
      const groups = geo.groups.length
        ? geo.groups
        : [{ start: 0, count: idx ? idx.count : pos.count, materialIndex: 0 }];
      for (const g of groups) {
        const m = mats[g.materialIndex ?? 0] ?? mats[0]!;
        const name = safeName(m.name || `mat_${m.uuid.slice(0, 6)}`);
        if (!mtls.has(name)) mtls.set(name, mtlBlock(name, m));
        out.push(`usemtl ${name}`);
        for (let k = g.start; k < Math.min(g.start + g.count, triCount * 3); k += 3) {
          const face = [0, 1, 2].map((j) => {
            const vi = (idx ? idx.getX(k + j) : k + j) + 0;
            const a = vBase + vi;
            const b = uv ? `${vtBase + vi}` : '';
            const c = nor ? `${vnBase + vi}` : '';
            return nor || uv ? `${a}/${b}${c ? `/${c}` : ''}` : `${a}`;
          });
          out.push(`f ${face.join(' ')}`);
        }
      }
      vBase += pos.count;
      if (uv) vtBase += uv.count;
      if (nor) vnBase += nor.count;
    });
    return { obj: out.join('\n') + '\n', mtl: [...mtls.values()].join('\n'), mtlName };
  } finally {
    dispose();
  }
}
