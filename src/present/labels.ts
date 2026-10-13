import { Matrix4, Vector3 } from 'three';
import { labelPoint, polygonBounds } from '../geometry/polygon';
import { fmtNum } from '../i18n';
import type { Project, Room, Units } from '../model/types';
import { formatArea } from '../ui/units';

export type LabelMode = 'dims' | 'area' | 'both';
export type LabelFont = 'sans' | 'serif' | 'mono';

export interface LabelStyle {
  show: boolean;
  mode: LabelMode;
  font: LabelFont;
  /** Font size as a fraction of the picture's shorter side (0.012–0.04). */
  size: number;
  /** `pill`: light rounded background; `shadow`: text with a soft shadow only. */
  backdrop: 'pill' | 'shadow';
}

export const DEFAULT_LABEL_STYLE: LabelStyle = {
  show: true,
  mode: 'dims',
  font: 'sans',
  size: 0.02,
  backdrop: 'pill',
};

const FT = 0.3048;

/** One side of a room as feet-inches (`14'` or `14'3"`) or metres (`4.3`). */
function side(m: number, units: Units): string {
  if (units === 'metric') return fmtNum(Math.round(m * 10) / 10, 1);
  const totalIn = Math.round(m / FT / (1 / 12));
  const feet = Math.floor(totalIn / 12);
  const inch = totalIn % 12;
  return inch === 0 ? `${fmtNum(feet, 0)}'` : `${fmtNum(feet, 0)}'${fmtNum(inch, 0)}"`;
}

/** `14' x 12'` or `4.3 × 3.7 m` — the room's bounding width × depth. */
export function roomDimensions(room: Room, units: Units): string {
  const b = polygonBounds(room.polygon);
  const w = b.max.x - b.min.x;
  const d = b.max.y - b.min.y;
  return units === 'metric'
    ? `${side(w, units)} × ${side(d, units)} m`
    : `${side(w, units)} x ${side(d, units)}`;
}

export interface RoomLabel {
  roomId: string;
  /** First line: the room's name. */
  title: string;
  /** Second line: size and/or area ('' when the style asks for neither). */
  detail: string;
  /** Where the text sits in the world (metres, y up): the room's label point on its floor. */
  world: { x: number; y: number; z: number };
}

export interface LabelOptions {
  mode: LabelMode;
  /** Rooms the user switched off. */
  hidden: ReadonlySet<string>;
  /** Only these levels (the ones visible in the picture). */
  levelIds: ReadonlySet<string> | null;
}

/** The labels to draw for a project: name plus dimensions and/or area per room. Void ("open to below") rooms are skipped. */
export function roomLabels(project: Project, o: LabelOptions): RoomLabel[] {
  const out: RoomLabel[] = [];
  for (const r of project.rooms) {
    if (o.hidden.has(r.id) || (o.levelIds && !o.levelIds.has(r.levelId))) continue;
    if (r.name === 'Open to below') continue;
    const level = project.levels.find((l) => l.id === r.levelId);
    if (!level) continue;
    const p = labelPoint(r.polygon);
    const parts: string[] = [];
    if (o.mode === 'dims' || o.mode === 'both') parts.push(roomDimensions(r, project.units));
    if (o.mode === 'area' || o.mode === 'both') {
      parts.push(formatArea(polygonAreaOf(r), project.units));
    }
    out.push({
      roomId: r.id,
      title: r.name,
      detail: parts.join('  ·  '),
      world: { x: p.x, y: level.elevation + 0.05, z: p.y },
    });
  }
  return out;
}

const polygonAreaOf = (r: Room): number => {
  let a = 0;
  r.polygon.forEach((p, i) => {
    const q = r.polygon[(i + 1) % r.polygon.length]!;
    a += p.x * q.y - q.x * p.y;
  });
  return Math.abs(a) / 2;
};

export interface ScreenLabel extends RoomLabel {
  /** Pixels from the left / top of the picture. */
  sx: number;
  sy: number;
}

/**
 * Projects labels to picture pixels with a camera's view-projection matrix (`projection × matrixWorldInverse`).
 * Labels behind the camera or outside the picture are dropped.
 */
export function projectLabels(
  labels: RoomLabel[],
  viewProjection: Matrix4 | number[],
  width: number,
  height: number,
): ScreenLabel[] {
  const m = Array.isArray(viewProjection)
    ? new Matrix4().fromArray(viewProjection)
    : viewProjection;
  const v = new Vector3();
  const out: ScreenLabel[] = [];
  for (const l of labels) {
    v.set(l.world.x, l.world.y, l.world.z).applyMatrix4(m);
    // After the perspective divide (applyMatrix4 divides by w) z outside −1…1 means behind or beyond the planes.
    if (
      !Number.isFinite(v.x) ||
      v.z < -1 ||
      v.z > 1 ||
      Math.abs(v.x) > 1.05 ||
      Math.abs(v.y) > 1.05
    )
      continue;
    out.push({ ...l, sx: ((v.x + 1) / 2) * width, sy: ((1 - v.y) / 2) * height });
  }
  return out;
}

const FAMILY: Record<LabelFont, string> = {
  sans: "'Inter', 'Segoe UI', system-ui, sans-serif",
  serif: "Georgia, 'Times New Roman', serif",
  mono: "ui-monospace, 'SF Mono', Consolas, monospace",
};

/** Draws the labels on a canvas context (the live overlay and the exported picture use the same code). */
export function drawLabels(
  ctx: CanvasRenderingContext2D,
  labels: ScreenLabel[],
  style: LabelStyle,
  width: number,
  height: number,
): void {
  const px = Math.max(10, Math.round(Math.min(width, height) * style.size));
  ctx.save();
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  for (const l of labels) {
    const lines: [string, string][] = [[l.title, `600 ${px}px ${FAMILY[style.font]}`]];
    if (l.detail) lines.push([l.detail, `400 ${Math.round(px * 0.82)}px ${FAMILY[style.font]}`]);
    const gap = px * 0.25;
    const heights = lines.map(([, f]) => Number(/(\d+)px/.exec(f)![1]));
    const total = heights.reduce((a, b) => a + b, 0) + gap * (lines.length - 1);
    let widest = 0;
    for (const [text, font] of lines) {
      ctx.font = font;
      widest = Math.max(widest, ctx.measureText(text).width);
    }
    if (style.backdrop === 'pill') {
      const padX = px * 0.7;
      const padY = px * 0.4;
      const w = widest + padX * 2;
      const h = total + padY * 2;
      ctx.fillStyle = 'rgba(255,255,255,0.86)';
      ctx.shadowColor = 'rgba(15,23,42,0.25)';
      ctx.shadowBlur = px * 0.35;
      ctx.beginPath();
      ctx.roundRect(l.sx - w / 2, l.sy - h / 2, w, h, Math.min(h / 2, px));
      ctx.fill();
      ctx.shadowBlur = 0;
      ctx.fillStyle = '#0f172a';
    } else {
      ctx.fillStyle = '#ffffff';
      ctx.shadowColor = 'rgba(15,23,42,0.85)';
      ctx.shadowBlur = px * 0.5;
    }
    let y = l.sy - total / 2;
    lines.forEach(([text, font], i) => {
      ctx.font = font;
      y += heights[i]! / 2;
      ctx.fillText(text, l.sx, y);
      y += heights[i]! / 2 + gap;
    });
  }
  ctx.restore();
}
