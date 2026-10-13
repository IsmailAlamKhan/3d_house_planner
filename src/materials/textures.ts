import { CanvasTexture, RepeatWrapping, SRGBColorSpace, type Texture } from 'three';
import type { MaterialDef, TextureKind } from './library';

/** Deterministic PRNG so a material always looks the same. */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const hash = (s: string): number => {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
};

function parse(hex: string): [number, number, number] {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

/** `hex` lightened (factor > 1) or darkened (< 1). */
export function shade(hex: string, factor: number): string {
  const [r, g, b] = parse(hex).map((c) => Math.max(0, Math.min(255, Math.round(c * factor))));
  return `rgb(${r},${g},${b})`;
}

type Ctx = CanvasRenderingContext2D;
interface Paint {
  ctx: Ctx;
  size: number;
  base: string;
  accent: string;
  rnd: () => number;
}

/** Runs `fn` at the 9 wrapped offsets so anything crossing an edge reappears on the opposite side (seamless tiling). */
function wrapped(size: number, fn: (dx: number, dy: number) => void): void {
  for (const dx of [-size, 0, size]) for (const dy of [-size, 0, size]) fn(dx, dy);
}

function fillBase(p: Paint): void {
  p.ctx.fillStyle = p.base;
  p.ctx.fillRect(0, 0, p.size, p.size);
}

function planks({ ctx, size, base, accent, rnd }: Paint): void {
  const rows = 8;
  const h = size / rows;
  for (let r = 0; r < rows; r++) {
    const boards = 2 + Math.floor(rnd() * 2);
    const off = rnd() * size;
    for (let b = 0; b < boards; b++) {
      const w = size / boards;
      const x0 = off + b * w;
      const tone = 0.9 + rnd() * 0.2;
      wrapped(size, (dx, dy) => {
        const x = x0 + dx;
        const y = r * h + dy;
        ctx.fillStyle = shade(base, tone);
        ctx.fillRect(x, y, w, h);
        // grain
        ctx.strokeStyle = shade(accent, 0.9 + rnd() * 0.2);
        ctx.globalAlpha = 0.28;
        for (let g = 0; g < 5; g++) {
          const gy = y + rnd() * h;
          ctx.beginPath();
          ctx.moveTo(x, gy);
          ctx.bezierCurveTo(
            x + w * 0.3,
            gy + (rnd() - 0.5) * 4,
            x + w * 0.6,
            gy + (rnd() - 0.5) * 4,
            x + w,
            gy,
          );
          ctx.stroke();
        }
        ctx.globalAlpha = 1;
        ctx.strokeStyle = shade(accent, 0.7);
        ctx.lineWidth = 1.5;
        ctx.strokeRect(x, y, w, h);
      });
    }
  }
}

/** Chevron-style parquet: slanted planks whose direction alternates, forming rows of V shapes. */
function herringbone({ ctx, size, base, accent, rnd }: Paint): void {
  const rows = 8;
  const rowH = size / rows;
  const cols = 8;
  const pw = size / cols;
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const left = c % 2 === 0;
      const tone = 0.88 + rnd() * 0.24;
      wrapped(size, (dx, dy) => {
        const x = c * pw + dx;
        const y = r * rowH + dy;
        ctx.beginPath();
        if (left) {
          ctx.moveTo(x, y + rowH);
          ctx.lineTo(x, y + rowH * 0.5);
          ctx.lineTo(x + pw, y);
          ctx.lineTo(x + pw, y + rowH * 0.5);
        } else {
          ctx.moveTo(x, y);
          ctx.lineTo(x + pw, y + rowH * 0.5);
          ctx.lineTo(x + pw, y + rowH);
          ctx.lineTo(x, y + rowH * 0.5);
        }
        ctx.closePath();
        ctx.fillStyle = shade(base, tone);
        ctx.fill();
        ctx.strokeStyle = shade(accent, 0.8);
        ctx.lineWidth = 1.2;
        ctx.stroke();
      });
    }
  }
}

function tiles(p: Paint, cols: number, rows: number, subway: boolean): void {
  const { ctx, size, base, accent, rnd } = p;
  const tw = size / cols;
  const th = size / rows;
  ctx.fillStyle = accent; // grout
  ctx.fillRect(0, 0, size, size);
  const gap = Math.max(2, size / 128);
  for (let r = 0; r < rows; r++) {
    const off = subway && r % 2 === 1 ? tw / 2 : 0;
    for (let c = 0; c < cols + (subway ? 1 : 0); c++) {
      const tone = 0.96 + rnd() * 0.08;
      const x = c * tw - off;
      ctx.fillStyle = shade(base, tone);
      wrapped(size, (dx, dy) =>
        ctx.fillRect(x + dx + gap / 2, r * th + dy + gap / 2, tw - gap, th - gap),
      );
    }
  }
}

function brick({ ctx, size, base, accent, rnd }: Paint): void {
  const rows = 8;
  const cols = 4;
  const bh = size / rows;
  const bw = size / cols;
  ctx.fillStyle = accent; // mortar
  ctx.fillRect(0, 0, size, size);
  const gap = Math.max(3, size / 85);
  for (let r = 0; r < rows; r++) {
    const off = r % 2 === 1 ? bw / 2 : 0;
    for (let c = 0; c < cols + 1; c++) {
      const tone = 0.86 + rnd() * 0.28;
      wrapped(size, (dx, dy) => {
        ctx.fillStyle = shade(base, tone);
        ctx.fillRect(c * bw - off + dx + gap / 2, r * bh + dy + gap / 2, bw - gap, bh - gap);
      });
    }
  }
}

function speckle(p: Paint, count: number, maxR: number, alpha: number): void {
  const { ctx, size, accent, rnd } = p;
  for (let i = 0; i < count; i++) {
    const x = rnd() * size;
    const y = rnd() * size;
    const r = 0.5 + rnd() * maxR;
    ctx.fillStyle = rnd() > 0.5 ? shade(accent, 0.9) : shade(p.base, 1.1);
    ctx.globalAlpha = alpha * (0.3 + rnd());
    wrapped(size, (dx, dy) => {
      ctx.beginPath();
      ctx.arc(x + dx, y + dy, r, 0, Math.PI * 2);
      ctx.fill();
    });
  }
  ctx.globalAlpha = 1;
}

function marble(p: Paint): void {
  const { ctx, size, accent, rnd } = p;
  ctx.globalAlpha = 0.15;
  speckle(p, 120, 18, 0.5);
  ctx.globalAlpha = 1;
  ctx.lineCap = 'round';
  for (let v = 0; v < 7; v++) {
    let x = rnd() * size;
    let y = rnd() * size;
    let ang = rnd() * Math.PI * 2;
    const width = 0.6 + rnd() * 1.8;
    const pts: [number, number][] = [[x, y]];
    for (let s = 0; s < 40; s++) {
      ang += (rnd() - 0.5) * 0.9;
      x += Math.cos(ang) * 14;
      y += Math.sin(ang) * 14;
      pts.push([x, y]);
    }
    wrapped(size, (dx, dy) => {
      ctx.strokeStyle = shade(accent, 0.85);
      ctx.globalAlpha = 0.35;
      ctx.lineWidth = width;
      ctx.beginPath();
      pts.forEach(([px, py], i) =>
        i ? ctx.lineTo(px + dx, py + dy) : ctx.moveTo(px + dx, py + dy),
      );
      ctx.stroke();
    });
  }
  ctx.globalAlpha = 1;
}

function carpet(p: Paint): void {
  const { ctx, size, rnd } = p;
  for (let i = 0; i < size * 14; i++) {
    const x = rnd() * size;
    const y = rnd() * size;
    ctx.fillStyle = shade(p.base, 0.82 + rnd() * 0.36);
    ctx.fillRect(x, y, 1.6, 1.6);
  }
}

function slats({ ctx, size, base, accent, rnd }: Paint): void {
  const n = 8;
  const w = size / n;
  for (let i = 0; i < n; i++) {
    ctx.fillStyle = shade(base, 0.92 + rnd() * 0.16);
    ctx.fillRect(i * w, 0, w, size);
    ctx.strokeStyle = shade(accent, 0.8);
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(i * w, 0);
    ctx.lineTo(i * w, size);
    ctx.stroke();
    ctx.globalAlpha = 0.18;
    ctx.strokeStyle = accent;
    ctx.lineWidth = 1;
    for (let g = 0; g < 6; g++) {
      const gx = i * w + 4 + rnd() * (w - 8);
      ctx.beginPath();
      ctx.moveTo(gx, 0);
      ctx.lineTo(gx + (rnd() - 0.5) * 3, size);
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
  }
}

function stripes({ ctx, size, accent }: Paint): void {
  const n = 8;
  const w = size / n;
  ctx.fillStyle = accent;
  for (let i = 0; i < n; i += 2) ctx.fillRect(i * w + w * 0.25, 0, w * 0.5, size);
  ctx.globalAlpha = 0.4;
  for (let i = 1; i < n; i += 2) ctx.fillRect(i * w + w * 0.45, 0, w * 0.1, size);
  ctx.globalAlpha = 1;
}

function dots({ ctx, size, accent }: Paint): void {
  const n = 4;
  const s = size / n;
  ctx.fillStyle = accent;
  for (let r = 0; r < n; r++) {
    for (let c = 0; c < n; c++) {
      ctx.beginPath();
      ctx.arc(c * s + s / 2 + (r % 2 ? s / 2 : 0), r * s + s / 2, s * 0.14, 0, Math.PI * 2);
      ctx.arc(c * s + s / 2 + (r % 2 ? s / 2 : 0) - size, r * s + s / 2, s * 0.14, 0, Math.PI * 2);
      ctx.fill();
    }
  }
}

function damask({ ctx, size, accent }: Paint): void {
  const n = 2;
  const s = size / n;
  ctx.strokeStyle = accent;
  ctx.fillStyle = accent;
  ctx.lineWidth = 3;
  for (let r = 0; r < n; r++) {
    for (let c = 0; c < n; c++) {
      const cx = c * s + s / 2 + (r % 2 ? s / 2 : 0);
      const cy = r * s + s / 2;
      wrapped(size, (dx, dy) => {
        ctx.save();
        ctx.translate(cx + dx, cy + dy);
        ctx.globalAlpha = 0.85;
        ctx.beginPath();
        ctx.moveTo(0, -s * 0.3);
        ctx.bezierCurveTo(s * 0.22, -s * 0.12, s * 0.2, s * 0.15, 0, s * 0.3);
        ctx.bezierCurveTo(-s * 0.2, s * 0.15, -s * 0.22, -s * 0.12, 0, -s * 0.3);
        ctx.fill();
        ctx.globalAlpha = 0.5;
        ctx.beginPath();
        ctx.arc(0, 0, s * 0.38, 0, Math.PI * 2);
        ctx.stroke();
        ctx.restore();
      });
    }
  }
  ctx.globalAlpha = 1;
}

function laminate(p: Paint): void {
  const { ctx, size, accent, rnd } = p;
  ctx.globalAlpha = 0.14;
  ctx.strokeStyle = accent;
  for (let i = 0; i < 70; i++) {
    const y = rnd() * size;
    ctx.lineWidth = 0.6 + rnd() * 1.2;
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.bezierCurveTo(
      size * 0.3,
      y + (rnd() - 0.5) * 8,
      size * 0.7,
      y + (rnd() - 0.5) * 8,
      size,
      y,
    );
    ctx.stroke();
  }
  ctx.globalAlpha = 1;
}

function brushed(p: Paint): void {
  const { ctx, size, rnd } = p;
  for (let i = 0; i < 260; i++) {
    const y = rnd() * size;
    ctx.globalAlpha = 0.08 + rnd() * 0.1;
    ctx.strokeStyle = rnd() > 0.5 ? '#ffffff' : '#5b6068';
    ctx.lineWidth = 0.5 + rnd() * 1.2;
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(size, y + (rnd() - 0.5) * 2);
    ctx.stroke();
  }
  ctx.globalAlpha = 1;
}

function grass({ ctx, size, base, accent, rnd }: Paint): void {
  ctx.fillStyle = base;
  ctx.fillRect(0, 0, size, size);
  for (let i = 0; i < size * 5; i++) {
    const x = rnd() * size;
    const y = rnd() * size;
    ctx.strokeStyle =
      rnd() > 0.5 ? shade(accent, 0.8 + rnd() * 0.5) : shade(base, 0.8 + rnd() * 0.5);
    ctx.lineWidth = 1 + rnd();
    wrapped(size, (dx, dy) => {
      ctx.beginPath();
      ctx.moveTo(x + dx, y + dy);
      ctx.lineTo(x + dx + (rnd() - 0.5) * 4, y + dy - 3 - rnd() * 6);
      ctx.stroke();
    });
  }
}

function water({ ctx, size, base, accent, rnd }: Paint): void {
  ctx.fillStyle = base;
  ctx.fillRect(0, 0, size, size);
  ctx.lineWidth = 2;
  for (let i = 0; i < 28; i++) {
    const x = rnd() * size;
    const y = rnd() * size;
    const w = 20 + rnd() * 60;
    ctx.strokeStyle = shade(accent, 0.9 + rnd() * 0.3);
    wrapped(size, (dx, dy) => {
      ctx.beginPath();
      ctx.moveTo(x + dx, y + dy);
      ctx.quadraticCurveTo(x + dx + w / 2, y + dy - 6, x + dx + w, y + dy);
      ctx.stroke();
    });
  }
}

function pavingStone(p: Paint): void {
  const { ctx, size, base, accent, rnd } = p;
  ctx.fillStyle = accent;
  ctx.fillRect(0, 0, size, size);
  const rows = 4;
  const h = size / rows;
  const gap = Math.max(3, size / 90);
  for (let r = 0; r < rows; r++) {
    const cols = r % 2 ? 3 : 2;
    const w = size / cols;
    for (let c = 0; c < cols; c++) {
      ctx.fillStyle = shade(base, 0.88 + rnd() * 0.24);
      wrapped(size, (dx, dy) =>
        ctx.fillRect(c * w + dx + gap / 2, r * h + dy + gap / 2, w - gap, h - gap),
      );
    }
  }
}

function decking({ ctx, size, base, accent, rnd }: Paint): void {
  const boards = 8;
  const h = size / boards;
  for (let i = 0; i < boards; i++) {
    ctx.fillStyle = shade(base, 0.88 + rnd() * 0.24);
    ctx.fillRect(0, i * h, size, h - 3);
    ctx.fillStyle = accent;
    ctx.fillRect(0, i * h + h - 3, size, 3);
    ctx.strokeStyle = shade(base, 0.8);
    ctx.lineWidth = 1;
    for (let g = 0; g < 4; g++) {
      const y = i * h + 4 + rnd() * (h - 10);
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(size, y + (rnd() - 0.5) * 2);
      ctx.stroke();
    }
  }
}

function gravel({ ctx, size, base, accent, rnd }: Paint): void {
  ctx.fillStyle = base;
  ctx.fillRect(0, 0, size, size);
  for (let i = 0; i < size * 4; i++) {
    const x = rnd() * size;
    const y = rnd() * size;
    const r = 1 + rnd() * 3;
    ctx.fillStyle =
      rnd() > 0.5 ? shade(accent, 0.8 + rnd() * 0.5) : shade(base, 0.85 + rnd() * 0.4);
    wrapped(size, (dx, dy) => {
      ctx.beginPath();
      ctx.arc(x + dx, y + dy, r, 0, Math.PI * 2);
      ctx.fill();
    });
  }
}

function poolTile(p: Paint): void {
  // Small square mosaic tiles with pale grout.
  tiles(p, 8, 8, false);
}

const PAINTERS: Record<TextureKind, (p: Paint) => void> = {
  grass,
  water,
  'paving-stone': pavingStone,
  decking,
  gravel,
  'pool-tile': poolTile,
  'wood-planks': planks,
  herringbone,
  'tiles-square': (p) => tiles(p, 2, 2, false),
  'tiles-subway': (p) => tiles(p, 2, 4, true),
  'tiles-large': (p) => tiles(p, 1, 1, false),
  marble,
  concrete: (p) => speckle(p, 1400, 3, 0.35),
  carpet,
  brick,
  'wood-slats': slats,
  'wallpaper-stripes': stripes,
  'wallpaper-damask': damask,
  'wallpaper-dots': dots,
  laminate,
  'metal-brushed': brushed,
};

const SIZE = 512;
const canvases = new Map<string, HTMLCanvasElement | null>();
const textures = new Map<string, Texture | null>();
const swatches = new Map<string, string | null>();

/** The painted canvas for a material (cached). Returns null where canvas isn't available (tests). */
export function getTextureCanvas(def: MaterialDef): HTMLCanvasElement | null {
  if (!def.texture) return null;
  if (canvases.has(def.id)) return canvases.get(def.id) ?? null;
  let canvas: HTMLCanvasElement | null = null;
  try {
    const el = document.createElement('canvas');
    el.width = SIZE;
    el.height = SIZE;
    const ctx = el.getContext('2d');
    if (ctx) {
      const paint: Paint = {
        ctx,
        size: SIZE,
        base: def.color,
        accent: def.accent ?? shade(def.color, 0.8),
        rnd: mulberry32(hash(def.id)),
      };
      fillBase(paint);
      PAINTERS[def.texture](paint);
      canvas = el;
    }
  } catch {
    canvas = null; // no canvas support (tests): materials fall back to flat colour
  }
  canvases.set(def.id, canvas);
  return canvas;
}

/**
 * Three.js texture for a material. The image covers `def.textureScale` metres and the generators emit UVs in metres,
 * so `repeat = 1 / textureScale` gives every surface the same real-world pattern size.
 */
export function getTexture(def: MaterialDef): Texture | null {
  if (!def.texture) return null;
  if (textures.has(def.id)) return textures.get(def.id) ?? null;
  const canvas = getTextureCanvas(def);
  let tex: Texture | null = null;
  if (canvas) {
    tex = new CanvasTexture(canvas);
    tex.wrapS = tex.wrapT = RepeatWrapping;
    tex.repeat.set(1 / def.textureScale, 1 / def.textureScale);
    tex.colorSpace = SRGBColorSpace;
    tex.anisotropy = 4;
  }
  textures.set(def.id, tex);
  return tex;
}

/** Small PNG data URL for a picker swatch, or null for plain colors / no canvas. */
export function getSwatchUrl(def: MaterialDef): string | null {
  if (!def.texture) return null;
  if (swatches.has(def.id)) return swatches.get(def.id) ?? null;
  const src = getTextureCanvas(def);
  let url: string | null = null;
  if (src) {
    try {
      const c = document.createElement('canvas');
      c.width = c.height = 64;
      c.getContext('2d')?.drawImage(src, 0, 0, 64, 64);
      url = c.toDataURL('image/png');
    } catch {
      url = null;
    }
  }
  swatches.set(def.id, url);
  return url;
}
