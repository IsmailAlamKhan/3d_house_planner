/** Hand-made glb files for tests (no three.js, no DOM): valid glTF 2.0 binaries Blender can import. */

function pack(json: object, bin: Buffer): Buffer {
  let j = Buffer.from(JSON.stringify(json));
  j = Buffer.concat([j, Buffer.alloc((4 - (j.length % 4)) % 4, 0x20)]);
  const b = Buffer.concat([bin, Buffer.alloc((4 - (bin.length % 4)) % 4, 0)]);
  const total = 12 + 8 + j.length + 8 + b.length;
  const head = Buffer.alloc(12);
  head.write('glTF', 0, 'latin1');
  head.writeUInt32LE(2, 4);
  head.writeUInt32LE(total, 8);
  const chunk = (len: number, type: string) => {
    const c = Buffer.alloc(8);
    c.writeUInt32LE(len, 0);
    c.write(type, 4, 'latin1');
    return c;
  };
  return Buffer.concat([head, chunk(j.length, 'JSON'), j, chunk(b.length, 'BIN\0'), b]);
}

const floats = (v: number[]): Buffer => {
  const b = Buffer.alloc(v.length * 4);
  v.forEach((x, i) => b.writeFloatLE(x, i * 4));
  return b;
};

/** One triangle (extras: layer slab). */
export function triangleGlb(): Buffer {
  const bin = floats([0, 0, 0, 1, 0, 0, 0, 0, -1]);
  return pack(
    {
      asset: { version: '2.0' },
      scene: 0,
      scenes: [{ nodes: [0] }],
      nodes: [{ mesh: 0, extras: { layer: 'slab', id: 'slab:test' } }],
      meshes: [{ primitives: [{ attributes: { POSITION: 0 } }] }],
      accessors: [
        {
          bufferView: 0,
          componentType: 5126,
          count: 3,
          type: 'VEC3',
          min: [0, 0, -1],
          max: [1, 0, 0],
        },
      ],
      bufferViews: [{ buffer: 0, byteLength: 36 }],
      buffers: [{ byteLength: 36 }],
    },
    bin,
  );
}

/**
 * A 4 × 4 m floor (two triangles at y = 0) with a lightmap UV set (TEXCOORD_1 covers the left half of the atlas) and the
 * `bake` flag, plus a 1 m wall behind it that only blocks light (no lightmap). The smallest bundle the bake can use.
 */
export function floorGlb(): Buffer {
  const pos = [-2, 0, -2, 2, 0, -2, 2, 0, 2, -2, 0, 2];
  // glTF uv: v is flipped, the importer turns it back
  const uv0 = [0, 1, 1, 1, 1, 0, 0, 0];
  const uv1 = [0.02, 0.98, 0.48, 0.98, 0.48, 0.02, 0.02, 0.02];
  const idx = Buffer.alloc(12);
  [0, 2, 1, 0, 3, 2].forEach((x, i) => idx.writeUInt16LE(x, i * 2));
  const wallPos = [-2, 0, -2.5, 2, 0, -2.5, 2, 1, -2.5, -2, 1, -2.5];
  const wallIdx = Buffer.alloc(12);
  [0, 1, 2, 0, 2, 3].forEach((x, i) => wallIdx.writeUInt16LE(x, i * 2));
  const parts = [floats(pos), floats(uv0), floats(uv1), idx, floats(wallPos), wallIdx];
  const offs: number[] = [];
  let o = 0;
  for (const p of parts) {
    offs.push(o);
    o += p.length;
  }
  const bin = Buffer.concat(parts);
  return pack(
    {
      asset: { version: '2.0' },
      scene: 0,
      scenes: [{ nodes: [0, 1] }],
      nodes: [
        { mesh: 0, name: 'floor', extras: { layer: 'floor', id: 'floor:test', bake: true } },
        { mesh: 1, name: 'wall', extras: { layer: 'wall', id: 'wall:test' } },
      ],
      meshes: [
        { primitives: [{ attributes: { POSITION: 0, TEXCOORD_0: 1, TEXCOORD_1: 2 }, indices: 3 }] },
        { primitives: [{ attributes: { POSITION: 4 }, indices: 5 }] },
      ],
      accessors: [
        {
          bufferView: 0,
          componentType: 5126,
          count: 4,
          type: 'VEC3',
          min: [-2, 0, -2],
          max: [2, 0, 2],
        },
        { bufferView: 1, componentType: 5126, count: 4, type: 'VEC2' },
        { bufferView: 2, componentType: 5126, count: 4, type: 'VEC2' },
        { bufferView: 3, componentType: 5123, count: 6, type: 'SCALAR' },
        {
          bufferView: 4,
          componentType: 5126,
          count: 4,
          type: 'VEC3',
          min: [-2, 0, -2.5],
          max: [2, 1, -2.5],
        },
        { bufferView: 5, componentType: 5123, count: 6, type: 'SCALAR' },
      ],
      bufferViews: parts.map((p, i) => ({ buffer: 0, byteOffset: offs[i], byteLength: p.length })),
      buffers: [{ byteLength: bin.length }],
    },
    bin,
  );
}
