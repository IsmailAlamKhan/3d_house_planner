import { BufferAttribute, BufferGeometry } from 'three';

/**
 * Lightmap UVs for the static geometry (walls, floors, slabs, ceilings, roofs, ground, decks, pool basins).
 *
 * Architecture is made of flat faces, so charts are planar: triangles that share an edge and face the same way form one
 * chart, which is laid flat in its own plane at a fixed density (texels per metre) and packed into one atlas with shelf
 * packing. Every triangle gets its own three vertices (the geometry is "de-indexed"), so a chart never shares a vertex with
 * its neighbour and a UV seam costs nothing. The order of the triangles is unchanged, so material groups stay valid.
 *
 * This replaces a general unwrapper (xatlas) because the shapes here are planar; it is small, deterministic and testable
 * without WebAssembly, and the browser and the bake always agree because the browser makes the UVs and sends them.
 */

/** Margin around every chart in texels (Blender's bake margin is smaller, so charts never bleed into each other). */
const PAD = 3;
const MIN_CHART = 6;
const MAX_ATLAS = 4096;

export interface AtlasMeshIn {
  id: string;
  geometry: BufferGeometry;
}

export interface AtlasResult {
  width: number;
  height: number;
  /** The density the atlas ended up with (lower than asked when 4096 × 4096 was not enough). */
  texelsPerMetre: number;
  /** Lightmap UVs of each mesh, 2 floats per vertex of its de-indexed geometry. */
  uv1: Map<string, Float32Array>;
  /** Share of the atlas covered by charts (0–1). */
  fill: number;
}

/** A copy of the geometry without an index (3 vertices per triangle, the same order); material groups are kept. */
export function deindex(geo: BufferGeometry): BufferGeometry {
  if (!geo.index) return geo.clone();
  const index = geo.index.array;
  const out = new BufferGeometry();
  for (const name of Object.keys(geo.attributes)) {
    const src = geo.attributes[name] as BufferAttribute;
    const size = src.itemSize;
    const data = new (src.array.constructor as new (n: number) => Float32Array)(
      index.length * size,
    );
    for (let i = 0; i < index.length; i++)
      for (let k = 0; k < size; k++) data[i * size + k] = src.array[index[i]! * size + k]!;
    out.setAttribute(name, new BufferAttribute(data, size, src.normalized));
  }
  for (const g of geo.groups) out.addGroup(g.start, g.count, g.materialIndex);
  return out;
}

/** The de-indexed geometry with the lightmap UV set (`uv1`, the channel three.js uses for `lightMap.channel = 1`). */
export function withUv1(geo: BufferGeometry, uv1: Float32Array): BufferGeometry {
  const out = deindex(geo);
  out.setAttribute('uv1', new BufferAttribute(uv1, 2));
  return out;
}

/** A short hash of a geometry's shape, to tell whether a part changed since it was baked. */
export function geometryHash(geo: BufferGeometry): string {
  const p = geo.getAttribute('position');
  let a = 0x811c9dc5;
  let b = 0x9747b28c;
  const n = p.array.length;
  // every vertex coordinate, rounded to 0.1 mm
  for (let i = 0; i < n; i++) {
    const v = Math.round((p.array[i] as number) * 1e4) | 0;
    a = Math.imul(a ^ v, 0x01000193);
    b = Math.imul(b ^ (v + i), 0x85ebca6b);
  }
  const idx = geo.index?.count ?? 0;
  a = Math.imul(a ^ idx, 0x01000193);
  return `${(a >>> 0).toString(16).padStart(8, '0')}${(b >>> 0).toString(16).padStart(8, '0')}`;
}

interface Chart {
  mesh: number;
  /** Triangle numbers. */
  tris: number[];
  /** Per vertex of those triangles: (u, v) in metres in the chart plane, relative to the chart's corner. */
  uv: number[];
  w: number;
  h: number;
  /** Texel size including the margin. */
  tw: number;
  th: number;
  x: number;
  y: number;
}

const key = (x: number, y: number, z: number) =>
  `${Math.round(x * 1e4)},${Math.round(y * 1e4)},${Math.round(z * 1e4)}`;

/** Splits one mesh into planar charts and lays each flat. Triangle t has vertices 3t..3t+2 (or index values). */
function chartsOf(meshIndex: number, geo: BufferGeometry): { charts: Chart[]; triCount: number } {
  const pos = geo.getAttribute('position');
  const idx = geo.index?.array;
  const triCount = (idx ? idx.length : pos.count) / 3;
  const vi = (t: number, k: number) => (idx ? idx[t * 3 + k]! : t * 3 + k);
  const P = (t: number, k: number): [number, number, number] => {
    const i = vi(t, k);
    return [pos.getX(i), pos.getY(i), pos.getZ(i)];
  };

  // face normals and areas
  const nx = new Float32Array(triCount);
  const ny = new Float32Array(triCount);
  const nz = new Float32Array(triCount);
  const area = new Float32Array(triCount);
  for (let t = 0; t < triCount; t++) {
    const a = P(t, 0);
    const b = P(t, 1);
    const c = P(t, 2);
    const ux = b[0] - a[0];
    const uy = b[1] - a[1];
    const uz = b[2] - a[2];
    const vx = c[0] - a[0];
    const vy = c[1] - a[1];
    const vz = c[2] - a[2];
    const x = uy * vz - uz * vy;
    const y = uz * vx - ux * vz;
    const z = ux * vy - uy * vx;
    const len = Math.hypot(x, y, z);
    area[t] = len / 2;
    if (len > 1e-12) {
      nx[t] = x / len;
      ny[t] = y / len;
      nz[t] = z / len;
    }
  }

  // union-find over triangles that share an edge (by position) and face the same way
  const parent = new Int32Array(triCount).map((_, i) => i);
  const find = (i: number): number => {
    while (parent[i] !== i) {
      parent[i] = parent[parent[i]!]!;
      i = parent[i]!;
    }
    return i;
  };
  const edges = new Map<string, number>();
  for (let t = 0; t < triCount; t++) {
    const k = [0, 1, 2].map((j) => {
      const p = P(t, j);
      return key(p[0], p[1], p[2]);
    }) as [string, string, string];
    for (let e = 0; e < 3; e++) {
      const a = k[e]!;
      const b = k[(e + 1) % 3]!;
      const ek = a < b ? `${a}|${b}` : `${b}|${a}`;
      const other = edges.get(ek);
      if (other === undefined) edges.set(ek, t);
      else if (nx[t]! * nx[other]! + ny[t]! * ny[other]! + nz[t]! * nz[other]! > 0.9995) {
        parent[find(t)] = find(other);
      }
    }
  }
  const groups = new Map<number, number[]>();
  for (let t = 0; t < triCount; t++) {
    if (area[t]! < 1e-10) continue; // a sliver gets no chart (its UVs stay 0)
    const r = find(t);
    const g = groups.get(r);
    if (g) g.push(t);
    else groups.set(r, [t]);
  }

  const charts: Chart[] = [];
  for (const tris of groups.values()) {
    // the chart's plane: the area-weighted normal; u runs along the world x axis for floors and along the horizontal for walls
    let sx = 0;
    let sy = 0;
    let sz = 0;
    for (const t of tris) {
      sx += nx[t]! * area[t]!;
      sy += ny[t]! * area[t]!;
      sz += nz[t]! * area[t]!;
    }
    const len = Math.hypot(sx, sy, sz) || 1;
    const n: [number, number, number] = [sx / len, sy / len, sz / len];
    let t1: [number, number, number];
    if (Math.abs(n[1]) > 0.7) t1 = [1, 0, 0];
    else {
      // horizontal tangent: up × n
      const hx = n[2];
      const hz = -n[0];
      const hl = Math.hypot(hx, hz) || 1;
      t1 = [hx / hl, 0, hz / hl];
    }
    // t1 made orthogonal to n (for floors with a slight tilt), then the second axis
    const d = t1[0] * n[0] + t1[1] * n[1] + t1[2] * n[2];
    t1 = [t1[0] - d * n[0], t1[1] - d * n[1], t1[2] - d * n[2]];
    const tl = Math.hypot(...t1) || 1;
    t1 = [t1[0] / tl, t1[1] / tl, t1[2] / tl];
    const t2: [number, number, number] = [
      n[1] * t1[2] - n[2] * t1[1],
      n[2] * t1[0] - n[0] * t1[2],
      n[0] * t1[1] - n[1] * t1[0],
    ];
    const uv: number[] = [];
    let minU = Infinity;
    let minV = Infinity;
    let maxU = -Infinity;
    let maxV = -Infinity;
    for (const t of tris)
      for (let k = 0; k < 3; k++) {
        const p = P(t, k);
        const u = p[0] * t1[0] + p[1] * t1[1] + p[2] * t1[2];
        const v = p[0] * t2[0] + p[1] * t2[1] + p[2] * t2[2];
        uv.push(u, v);
        minU = Math.min(minU, u);
        maxU = Math.max(maxU, u);
        minV = Math.min(minV, v);
        maxV = Math.max(maxV, v);
      }
    for (let i = 0; i < uv.length; i += 2) {
      uv[i] = uv[i]! - minU;
      uv[i + 1] = uv[i + 1]! - minV;
    }
    charts.push({
      mesh: meshIndex,
      tris,
      uv,
      w: maxU - minU,
      h: maxV - minV,
      tw: 0,
      th: 0,
      x: 0,
      y: 0,
    });
  }
  return { charts, triCount };
}

/** Shelf-packs the charts into a `width`-wide atlas; returns the height used. */
function shelfPack(charts: Chart[], width: number): number {
  const order = [...charts].sort((a, b) => b.th - a.th || b.tw - a.tw);
  let x = 0;
  let y = 0;
  let shelf = 0;
  for (const c of order) {
    if (x + c.tw > width) {
      y += shelf;
      x = 0;
      shelf = 0;
    }
    c.x = x;
    c.y = y;
    x += c.tw;
    shelf = Math.max(shelf, c.th);
  }
  return y + shelf;
}

const pow2 = (n: number) => 2 ** Math.ceil(Math.log2(Math.max(n, 16)));

/**
 * One atlas for all the meshes. `texelsPerMetre` is the wish; when the charts do not fit in 4096 × 4096 the density is
 * lowered step by step until they do.
 */
export function buildLightmapAtlas(
  meshes: AtlasMeshIn[],
  opts: { texelsPerMetre: number; maxSize?: number },
): AtlasResult {
  const max = opts.maxSize ?? MAX_ATLAS;
  const per = meshes.map((m, i) => chartsOf(i, m.geometry));
  const charts = per.flatMap((p) => p.charts);
  let density = opts.texelsPerMetre;
  let width = 64;
  let height = 64;
  for (let attempt = 0; attempt < 40; attempt++) {
    let texels = 0;
    for (const c of charts) {
      c.tw = Math.max(MIN_CHART, Math.ceil(c.w * density)) + 2 * PAD;
      c.th = Math.max(MIN_CHART, Math.ceil(c.h * density)) + 2 * PAD;
      texels += c.tw * c.th;
    }
    // aim for a squarish atlas: width a power of two near sqrt(area / 0.75)
    width = Math.min(max, pow2(Math.sqrt(texels / 0.75)));
    const widest = charts.reduce((m, c) => Math.max(m, c.tw), 0);
    if (widest > width) width = Math.min(max, pow2(widest));
    const used = shelfPack(charts, width);
    height = pow2(used);
    if (widest <= width && height <= max) break;
    density *= 0.88;
  }
  const uv1 = new Map<string, Float32Array>();
  per.forEach((p, i) => uv1.set(meshes[i]!.id, new Float32Array(p.triCount * 6)));
  let covered = 0;
  for (const c of charts) {
    const out = uv1.get(meshes[c.mesh]!.id)!;
    c.tris.forEach((t, j) => {
      for (let k = 0; k < 3; k++) {
        const u = c.uv[(j * 3 + k) * 2]!;
        const v = c.uv[(j * 3 + k) * 2 + 1]!;
        out[(t * 3 + k) * 2] = (c.x + PAD + u * density) / width;
        out[(t * 3 + k) * 2 + 1] = (c.y + PAD + v * density) / height;
      }
    });
    covered += c.tw * c.th;
  }
  return { width, height, texelsPerMetre: density, uv1, fill: covered / (width * height) };
}
