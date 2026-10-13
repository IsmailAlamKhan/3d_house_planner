/**
 * A tiny but valid binary glTF 2.0 model: one box of the given size (metres), made of 12 triangles with one material.
 * Used by the tests (unit and end-to-end) as a stand-in for a user's own model.
 */
export function minimalGlb(
  w = 1,
  h = 1,
  d = 1,
  color: [number, number, number] = [0.8, 0.2, 0.2],
): Uint8Array {
  const x = w / 2;
  const z = d / 2;
  // 8 corners, 12 triangles (indices as unsigned shorts)
  const pos = new Float32Array([
    -x,
    0,
    -z,
    x,
    0,
    -z,
    x,
    h,
    -z,
    -x,
    h,
    -z,
    -x,
    0,
    z,
    x,
    0,
    z,
    x,
    h,
    z,
    -x,
    h,
    z,
  ]);
  const idx = new Uint16Array([
    0, 2, 1, 0, 3, 2, 4, 5, 6, 4, 6, 7, 0, 1, 5, 0, 5, 4, 3, 7, 6, 3, 6, 2, 0, 4, 7, 0, 7, 3, 1, 2,
    6, 1, 6, 5,
  ]);
  const posBytes = new Uint8Array(pos.buffer);
  const idxBytes = new Uint8Array(idx.buffer);
  const pad4 = (n: number) => (n + 3) & ~3;
  const bin = new Uint8Array(pad4(posBytes.length) + pad4(idxBytes.length));
  bin.set(posBytes, 0);
  bin.set(idxBytes, pad4(posBytes.length));
  const json = {
    asset: { version: '2.0', generator: 'duplex-designer-test' },
    scene: 0,
    scenes: [{ nodes: [0] }],
    nodes: [{ mesh: 0, name: 'box' }],
    meshes: [{ primitives: [{ attributes: { POSITION: 0 }, indices: 1, material: 0 }] }],
    materials: [{ pbrMetallicRoughness: { baseColorFactor: [...color, 1], metallicFactor: 0 } }],
    accessors: [
      {
        bufferView: 0,
        componentType: 5126,
        count: 8,
        type: 'VEC3',
        min: [-x, 0, -z],
        max: [x, h, z],
      },
      { bufferView: 1, componentType: 5123, count: idx.length, type: 'SCALAR' },
    ],
    bufferViews: [
      { buffer: 0, byteOffset: 0, byteLength: posBytes.length, target: 34962 },
      { buffer: 0, byteOffset: pad4(posBytes.length), byteLength: idxBytes.length, target: 34963 },
    ],
    buffers: [{ byteLength: bin.length }],
  };
  const jsonBytes = new TextEncoder().encode(JSON.stringify(json));
  const jsonPadded = new Uint8Array(pad4(jsonBytes.length)).fill(0x20); // JSON chunks are padded with spaces
  jsonPadded.set(jsonBytes, 0);
  const total = 12 + 8 + jsonPadded.length + 8 + bin.length;
  const out = new Uint8Array(total);
  const view = new DataView(out.buffer);
  out.set([0x67, 0x6c, 0x54, 0x46], 0); // "glTF"
  view.setUint32(4, 2, true);
  view.setUint32(8, total, true);
  view.setUint32(12, jsonPadded.length, true);
  out.set([0x4a, 0x53, 0x4f, 0x4e], 16); // "JSON"
  out.set(jsonPadded, 20);
  const binAt = 20 + jsonPadded.length;
  view.setUint32(binAt, bin.length, true);
  out.set([0x42, 0x49, 0x4e, 0x00], binAt + 4); // "BIN\0"
  out.set(bin, binAt + 8);
  return out;
}
