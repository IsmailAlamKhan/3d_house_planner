import { deflateSync, inflateSync } from 'node:zlib';

/**
 * A small PNG reader and writer (8-bit, not interlaced): enough for the pictures of the image pipeline (Blender's passes,
 * ComfyUI's results, masks), without an image library in the server.
 */
export interface Raster {
  width: number;
  height: number;
  /** 1 = grey, 2 = grey + alpha, 3 = RGB, 4 = RGBA. */
  channels: 1 | 2 | 3 | 4;
  data: Uint8Array;
}

const SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const CHANNELS: Record<number, 1 | 2 | 3 | 4> = { 0: 1, 4: 2, 2: 3, 6: 4 };

const paeth = (a: number, b: number, c: number): number => {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);
  return pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
};

/** Decodes an 8-bit, non-interlaced PNG (grey, grey + alpha, RGB or RGBA). Throws on anything else. */
export function decodePng(buf: Uint8Array): Raster {
  const b = Buffer.from(buf.buffer, buf.byteOffset, buf.byteLength);
  if (b.length < 33 || !b.subarray(0, 8).equals(SIGNATURE)) throw new Error('Not a PNG file');
  let width = 0;
  let height = 0;
  let channels: 1 | 2 | 3 | 4 = 3;
  const idat: Buffer[] = [];
  for (let at = 8; at + 8 <= b.length;) {
    const len = b.readUInt32BE(at);
    const type = b.toString('latin1', at + 4, at + 8);
    const body = b.subarray(at + 8, at + 8 + len);
    if (type === 'IHDR') {
      width = body.readUInt32BE(0);
      height = body.readUInt32BE(4);
      const depth = body[8]!;
      const colour = body[9]!;
      const interlace = body[12]!;
      if (depth !== 8 || interlace !== 0 || !(colour in CHANNELS))
        throw new Error(
          `Unsupported PNG (depth ${depth}, colour type ${colour}, interlace ${interlace})`,
        );
      channels = CHANNELS[colour]!;
    } else if (type === 'IDAT') idat.push(body);
    else if (type === 'IEND') break;
    at += 12 + len;
  }
  if (!width || !height) throw new Error('The PNG has no header');
  const raw = inflateSync(Buffer.concat(idat));
  const stride = width * channels;
  if (raw.length < (stride + 1) * height) throw new Error('The PNG data is truncated');
  const out = new Uint8Array(stride * height);
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)]!;
    const line = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1));
    const row = y * stride;
    for (let x = 0; x < stride; x++) {
      const left = x >= channels ? out[row + x - channels]! : 0;
      const up = y > 0 ? out[row - stride + x]! : 0;
      const upLeft = y > 0 && x >= channels ? out[row - stride + x - channels]! : 0;
      const v = line[x]!;
      out[row + x] =
        filter === 0
          ? v
          : filter === 1
            ? v + left
            : filter === 2
              ? v + up
              : filter === 3
                ? v + ((left + up) >> 1)
                : v + paeth(left, up, upLeft);
    }
  }
  return { width, height, channels, data: out };
}

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(buf: Buffer): number {
  let c = 0xffffffff;
  for (const x of buf) c = CRC_TABLE[(c ^ x) & 0xff]! ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type: string, body: Buffer): Buffer {
  const head = Buffer.alloc(8);
  head.writeUInt32BE(body.length, 0);
  head.write(type, 4, 'latin1');
  const tail = Buffer.alloc(4);
  tail.writeUInt32BE(crc32(Buffer.concat([head.subarray(4), body])), 0);
  return Buffer.concat([head, body, tail]);
}

/** Encodes a raster as an 8-bit PNG (no filtering: fast, and the pictures here are small or flat). */
export function encodePng(r: Raster): Buffer {
  const colour = { 1: 0, 2: 4, 3: 2, 4: 6 }[r.channels];
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(r.width, 0);
  ihdr.writeUInt32BE(r.height, 4);
  ihdr[8] = 8;
  ihdr[9] = colour;
  const stride = r.width * r.channels;
  const raw = Buffer.alloc((stride + 1) * r.height);
  for (let y = 0; y < r.height; y++) {
    raw[y * (stride + 1)] = 0;
    Buffer.from(r.data.buffer, r.data.byteOffset + y * stride, stride).copy(
      raw,
      y * (stride + 1) + 1,
    );
  }
  return Buffer.concat([
    SIGNATURE,
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 6 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}
