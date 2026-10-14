import { deflateSync, inflateSync } from 'node:zlib';

/** Just enough PNG for the evaluation scripts: 8-bit RGB / RGBA in, RGBA raster out; RGB PNG out. No dependencies. */
export interface Raster {
  data: Uint8ClampedArray;
  width: number;
  height: number;
}

export function decodePng(buf: Buffer): Raster {
  if (buf.readUInt32BE(0) !== 0x89504e47) throw new Error('not a PNG');
  let pos = 8;
  let width = 0;
  let height = 0;
  let depth = 0;
  let color = 0;
  const idat: Buffer[] = [];
  while (pos < buf.length) {
    const len = buf.readUInt32BE(pos);
    const type = buf.toString('ascii', pos + 4, pos + 8);
    const data = buf.subarray(pos + 8, pos + 8 + len);
    if (type === 'IHDR') {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      depth = data[8]!;
      color = data[9]!;
    } else if (type === 'IDAT') idat.push(data);
    pos += 12 + len;
  }
  const bpp = color === 6 ? 4 : color === 2 ? 3 : 0;
  if (!bpp || depth !== 8)
    throw new Error(`unsupported PNG (colour type ${color}, depth ${depth})`);
  const raw = inflateSync(Buffer.concat(idat));
  const stride = width * bpp;
  const px = Buffer.alloc(height * stride);
  for (let y = 0; y < height; y++) {
    const f = raw[y * (stride + 1)]!;
    for (let x = 0; x < stride; x++) {
      const rv = raw[y * (stride + 1) + 1 + x]!;
      const a = x >= bpp ? px[y * stride + x - bpp]! : 0;
      const b = y > 0 ? px[(y - 1) * stride + x]! : 0;
      const c = x >= bpp && y > 0 ? px[(y - 1) * stride + x - bpp]! : 0;
      let v: number;
      if (f === 0) v = rv;
      else if (f === 1) v = rv + a;
      else if (f === 2) v = rv + b;
      else if (f === 3) v = rv + ((a + b) >> 1);
      else {
        const p = a + b - c;
        const pa = Math.abs(p - a);
        const pb = Math.abs(p - b);
        const pc = Math.abs(p - c);
        v = rv + (pa <= pb && pa <= pc ? a : pb <= pc ? b : c);
      }
      px[y * stride + x] = v & 255;
    }
  }
  const out = new Uint8ClampedArray(width * height * 4);
  for (let i = 0; i < width * height; i++) {
    out[i * 4] = px[i * bpp]!;
    out[i * 4 + 1] = px[i * bpp + 1]!;
    out[i * 4 + 2] = px[i * bpp + 2]!;
    out[i * 4 + 3] = bpp === 4 ? px[i * bpp + 3]! : 255;
  }
  return { data: out, width, height };
}

function crc32(b: Buffer): number {
  let crc = 0xffffffff;
  for (let n = 0; n < b.length; n++) {
    let c = (crc ^ b[n]!) & 0xff;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    crc = (crc >>> 8) ^ c;
  }
  return (crc ^ 0xffffffff) >>> 0;
}
const chunk = (type: string, data: Buffer) => {
  const t = Buffer.from(type, 'ascii');
  const l = Buffer.alloc(4);
  l.writeUInt32BE(data.length);
  const c = Buffer.alloc(4);
  c.writeUInt32BE(crc32(Buffer.concat([t, data])));
  return Buffer.concat([l, t, data, c]);
};

/** RGB PNG (alpha composited on white). */
export function encodePng(r: Raster): Buffer {
  const rows = Buffer.alloc(r.height * (r.width * 3 + 1));
  for (let y = 0; y < r.height; y++) {
    rows[y * (r.width * 3 + 1)] = 0;
    for (let x = 0; x < r.width; x++) {
      const i = (y * r.width + x) * 4;
      const a = r.data[i + 3]! / 255;
      const o = y * (r.width * 3 + 1) + 1 + x * 3;
      for (let c = 0; c < 3; c++) rows[o + c] = Math.round(r.data[i + c]! * a + 255 * (1 - a));
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(r.width, 0);
  ihdr.writeUInt32BE(r.height, 4);
  ihdr[8] = 8;
  ihdr[9] = 2;
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(rows)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

/** A piece of a raster, scaled (area-averaged when shrinking, bilinear otherwise) so its longer side is at most `maxSide`. */
export function cropScaled(
  r: Raster,
  box: { x: number; y: number; w: number; h: number },
  maxSide: number,
): Raster {
  const k = Math.min(1, maxSide / Math.max(box.w, box.h));
  const w = Math.max(1, Math.round(box.w * k));
  const h = Math.max(1, Math.round(box.h * k));
  const out = new Uint8ClampedArray(w * h * 4).fill(255);
  const at = (x: number, y: number, c: number) => {
    const xx = Math.min(r.width - 1, Math.max(0, Math.floor(x)));
    const yy = Math.min(r.height - 1, Math.max(0, Math.floor(y)));
    return r.data[(yy * r.width + xx) * 4 + c]!;
  };
  const step = 1 / k;
  const samples = Math.max(1, Math.min(4, Math.round(step)));
  for (let j = 0; j < h; j++)
    for (let i = 0; i < w; i++) {
      for (let c = 0; c < 3; c++) {
        let sum = 0;
        for (let sj = 0; sj < samples; sj++)
          for (let si = 0; si < samples; si++)
            sum += at(
              box.x + (i + (si + 0.5) / samples) * step,
              box.y + (j + (sj + 0.5) / samples) * step,
              c,
            );
        out[(j * w + i) * 4 + c] = sum / (samples * samples);
      }
      out[(j * w + i) * 4 + 3] = 255;
    }
  return { data: out, width: w, height: h };
}
