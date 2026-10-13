import { renderToStaticMarkup } from 'react-dom/server';
import { clearArea } from '../checks/areas';
import { isVoidRoom } from '../checks/voidRoom';
import { polygonBounds, labelPoint } from '../geometry/polygon';
import { type Vec2, dist } from '../geometry/vec';
import { computeWallPolygons } from '../geometry/walls';
import { t } from '../i18n';
import type { Project, Room, RoomType } from '../model/types';
import { ItemSymbol, OpeningSymbol, StairSymbol } from '../plan2d/symbols';
import { formatArea, formatLength } from '../ui/units';

export type PlanScale = 50 | 100;

export interface PlanSvgOptions {
  /** 50 → 1:50, 100 → 1:100. */
  scale: PlanScale;
  /** Overall dimensions along the outside of the building and clear room sizes. */
  dimensions?: boolean;
  /** Furniture and fixtures. */
  furniture?: boolean;
}

export interface PlanSvg {
  svg: string;
  /** The drawing area in plan metres (x0,y0 → x1,y1), including the margin around the building. */
  box: { x0: number; y0: number; x1: number; y1: number };
  /** Size of the sheet content on paper (mm) at the chosen scale. */
  widthMm: number;
  heightMm: number;
}

/** Paper millimetres per metre of building at 1:scale. */
export const mmPerMetre = (scale: number): number => 1000 / scale;

const ROOM_FILL: Record<RoomType, string> = {
  living: '#fef3c7',
  kitchen: '#fed7aa',
  bedroom: '#e0e7ff',
  bathroom: '#cffafe',
  dining: '#fde68a',
  study: '#ddd6fe',
  utility: '#e5e7eb',
  balcony: '#d9f99d',
  outdoor: '#bef264',
  corridor: '#f1f5f9',
  stair: '#fbcfe8',
  foyer: '#fde68a',
  'walk-in-closet': '#e9d5ff',
  gym: '#bbf7d0',
  sauna: '#fed7aa',
  spa: '#a5f3fc',
  'game-room': '#c7d2fe',
  garage: '#d4d4d8',
  laundry: '#e5e7eb',
  pantry: '#fef9c3',
  'home-theatre': '#ddd6fe',
  prayer: '#fce7f3',
  'outdoor-dining': '#d9f99d',
  other: '#f1f5f9',
};
const WALL_COLOR = { exterior: '#334155', interior: '#475569', partition: '#64748b' } as const;

const esc = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const n = (v: number) => (Math.round(v * 10000) / 10000).toString();
const pts = (poly: Vec2[]) => poly.map((p) => `${n(p.x)},${n(p.y)}`).join(' ');

/**
 * The on-screen plan symbols are drawn with 1-pixel, non-scaling strokes. On paper a unit is a metre, so rewrite
 * their stroke widths and dashes into metres (one "pixel" = `unit` metres) and drop the screen-only attribute.
 */
export function toPaperStrokes(markup: string, unit: number): string {
  return markup
    .replace(/ vector-effect="non-scaling-stroke"/g, '')
    .replace(/stroke-width="([\d.]+)"/g, (_, w: string) => `stroke-width="${n(Number(w) * unit)}"`)
    .replace(/stroke-dasharray="([^"]+)"/g, (_, d: string) => {
      const parts = d
        .split(/[ ,]+/)
        .map((x) => n(Number(x) * unit))
        .join(' ');
      return `stroke-dasharray="${parts}"`;
    });
}

function dimensionLine(
  a: Vec2,
  b: Vec2,
  side: 1 | -1,
  offset: number,
  label: string,
  fs: number,
  sw: number,
): string {
  const len = dist(a, b);
  if (len < 1e-6) return '';
  const ux = (b.x - a.x) / len;
  const uy = (b.y - a.y) / len;
  const nx = -uy * side;
  const ny = ux * side;
  const p = { x: a.x + nx * offset, y: a.y + ny * offset };
  const q = { x: b.x + nx * offset, y: b.y + ny * offset };
  const tick = fs * 0.5;
  const mid = { x: (p.x + q.x) / 2 + nx * fs * 0.35, y: (p.y + q.y) / 2 + ny * fs * 0.35 };
  let angle = (Math.atan2(uy, ux) * 180) / Math.PI;
  if (angle > 90 || angle < -90) angle += 180;
  const ext = (s: Vec2, e: Vec2) =>
    `<line x1="${n(s.x)}" y1="${n(s.y)}" x2="${n(e.x + nx * tick)}" y2="${n(e.y + ny * tick)}"/>`;
  return `<g stroke="#0369a1" stroke-width="${n(sw)}" fill="#0369a1">
    ${ext(a, p)}${ext(b, q)}
    <line x1="${n(p.x)}" y1="${n(p.y)}" x2="${n(q.x)}" y2="${n(q.y)}"/>
    <line x1="${n(p.x - ux * tick * 0.7 - nx * tick * 0.7)}" y1="${n(p.y - uy * tick * 0.7 - ny * tick * 0.7)}" x2="${n(p.x + ux * tick * 0.7 + nx * tick * 0.7)}" y2="${n(p.y + uy * tick * 0.7 + ny * tick * 0.7)}"/>
    <line x1="${n(q.x - ux * tick * 0.7 - nx * tick * 0.7)}" y1="${n(q.y - uy * tick * 0.7 - ny * tick * 0.7)}" x2="${n(q.x + ux * tick * 0.7 + nx * tick * 0.7)}" y2="${n(q.y + uy * tick * 0.7 + ny * tick * 0.7)}"/>
    <text x="${n(mid.x)}" y="${n(mid.y)}" font-size="${n(fs)}" text-anchor="middle" stroke="none" font-family="Helvetica, Arial, sans-serif" transform="rotate(${n(angle)} ${n(mid.x)} ${n(mid.y)})">${esc(label)}</text>
  </g>`;
}

function scaleBar(x: number, y: number, scale: number, mm: (v: number) => number): string {
  // 5 m long, in 1 m segments (alternating black and white), labelled 0 … 5 m.
  const seg = 1;
  const h = mm(1.6);
  const fs = mm(2.2);
  let out = `<g font-family="Helvetica, Arial, sans-serif" font-size="${n(fs)}" fill="#0f172a">`;
  for (let i = 0; i < 5; i++)
    out += `<rect x="${n(x + i * seg)}" y="${n(y)}" width="${n(seg)}" height="${n(h)}" fill="${i % 2 ? '#ffffff' : '#0f172a'}" stroke="#0f172a" stroke-width="${n(mm(0.18))}"/>`;
  for (let i = 0; i <= 5; i++)
    out += `<text x="${n(x + i * seg)}" y="${n(y + h + fs * 1.1)}" text-anchor="middle">${i}</text>`;
  out += `<text x="${n(x + 5 + mm(2))}" y="${n(y + h + fs * 1.1)}">m</text>`;
  out += `<text x="${n(x)}" y="${n(y - fs * 0.5)}" font-weight="bold">1:${scale}</text></g>`;
  return out;
}

function northArrow(cx: number, cy: number, bearing: number, mm: (v: number) => number): string {
  const r = mm(6);
  return `<g transform="translate(${n(cx)} ${n(cy)}) rotate(${n(bearing)})" font-family="Helvetica, Arial, sans-serif">
    <circle r="${n(r)}" fill="#ffffff" stroke="#0f172a" stroke-width="${n(mm(0.25))}"/>
    <polygon points="0,${n(-r * 0.85)} ${n(r * 0.35)},${n(r * 0.5)} 0,${n(r * 0.2)} ${n(-r * 0.35)},${n(r * 0.5)}" fill="#0f172a"/>
    <text y="${n(-r * 1.15)}" font-size="${n(mm(3.2))}" font-weight="bold" text-anchor="middle" fill="#0f172a">N</text>
  </g>`;
}

const roomVisible = (project: Project, room: Room) => !isVoidRoom(project, room);

/**
 * A static, print-ready SVG of one level in metres (the viewBox is in plan metres; width/height are millimetres on
 * paper at the chosen scale, so a 5 m wall is 100 mm long at 1:50). Strokes and text are sized in paper millimetres.
 */
export function planSvg(project: Project, levelId: string, opts: PlanSvgOptions): PlanSvg {
  const S = opts.scale;
  const mm = (v: number) => (v * S) / 1000; // paper mm → plan metres
  const level = project.levels.find((l) => l.id === levelId);
  const fb = polygonBounds(project.shell.footprint);
  const m = mm(18);
  const box = { x0: fb.min.x - m, y0: fb.min.y - m, x1: fb.max.x + m, y1: fb.max.y + m * 1.8 };
  const widthMm = (box.x1 - box.x0) * mmPerMetre(S);
  const heightMm = (box.y1 - box.y0) * mmPerMetre(S);

  const walls = project.walls.filter((w) => w.levelId === levelId);
  const polys = computeWallPolygons(walls);
  const wallById = new Map(walls.map((w) => [w.id, w]));
  const rooms = project.rooms.filter((r) => r.levelId === levelId && roomVisible(project, r));
  const wsw = mm(0.25);

  let body = '';
  // Footprint outline (what the shell allows) as a thin dashed line.
  body += `<polygon points="${pts(project.shell.footprint)}" fill="#ffffff" stroke="#94a3b8" stroke-width="${n(mm(0.2))}" stroke-dasharray="${n(mm(2))} ${n(mm(1.2))}"/>`;
  for (const r of rooms)
    body += `<polygon points="${pts(r.polygon)}" fill="${ROOM_FILL[r.type]}" stroke="none"/>`;
  for (const w of walls) {
    const poly = polys.get(w.id);
    if (poly)
      body += `<polygon points="${pts(poly)}" fill="${WALL_COLOR[w.type]}" stroke="#0f172a" stroke-width="${n(wsw)}"/>`;
  }
  for (const c of project.columns.filter((k) => k.levelId === levelId))
    body +=
      c.shape === 'round'
        ? `<ellipse cx="${n(c.position.x)}" cy="${n(c.position.y)}" rx="${n(c.size.w / 2)}" ry="${n(c.size.d / 2)}" fill="#0f172a"/>`
        : `<rect x="${n(c.position.x - c.size.w / 2)}" y="${n(c.position.y - c.size.d / 2)}" width="${n(c.size.w)}" height="${n(c.size.d)}" fill="#0f172a"/>`;

  const unit = mm(0.25);
  for (const o of project.openings) {
    const wall = wallById.get(o.wallId);
    if (!wall) continue;
    body += toPaperStrokes(
      renderToStaticMarkup(
        <OpeningSymbol opening={o} wall={wall} footprint={project.shell.footprint} />,
      ),
      unit,
    );
  }
  for (const stair of project.stairs.filter(
    (s) => s.fromLevelId === levelId || s.toLevelId === levelId,
  ))
    body += toPaperStrokes(
      renderToStaticMarkup(
        <StairSymbol project={project} stair={stair} levelId={levelId} selected={false} />,
      ),
      unit,
    );
  if (opts.furniture !== false)
    for (const item of project.items.filter((i) => i.levelId === levelId))
      body += toPaperStrokes(renderToStaticMarkup(<ItemSymbol item={item} />), unit);

  // Room labels: name, area and clear size.
  const fsName = mm(3);
  const fsSmall = mm(2.4);
  for (const r of rooms) {
    const b = polygonBounds(r.polygon);
    const w = b.max.x - b.min.x;
    const h = b.max.y - b.min.y;
    if (w < mm(14) || h < mm(9)) continue;
    const c = labelPoint(r.polygon);
    const lines = [
      { text: r.name, fs: fsName, bold: true },
      { text: formatArea(clearArea(project, r), project.units), fs: fsSmall, bold: false },
    ];
    if (opts.dimensions !== false)
      lines.push({
        text: `${formatLength(w, project.units, 2)} × ${formatLength(h, project.units, 2)}`,
        fs: fsSmall,
        bold: false,
      });
    let y = c.y - (lines.length - 1) * fsName * 0.6;
    // A soft white backing keeps the text readable over furniture and columns.
    const textW = Math.max(...lines.map((l) => l.text.length * l.fs * 0.55));
    const textH = lines.reduce((sum, l) => sum + l.fs * 1.3, 0);
    body += `<rect x="${n(c.x - textW / 2 - fsSmall * 0.3)}" y="${n(y - fsName * 0.95)}" width="${n(textW + fsSmall * 0.6)}" height="${n(textH + fsSmall * 0.3)}" fill="#ffffff" fill-opacity="0.72" stroke="none"/>`;
    body += `<g font-family="Helvetica, Arial, sans-serif" text-anchor="middle" fill="#0f172a">`;
    for (const l of lines) {
      body += `<text x="${n(c.x)}" y="${n(y)}" font-size="${n(l.fs)}"${l.bold ? ' font-weight="bold"' : ''}>${esc(l.text)}</text>`;
      y += l.fs * 1.3;
    }
    body += `</g>`;
  }

  // Dimensions along the outside of the footprint.
  if (opts.dimensions !== false) {
    const fp = project.shell.footprint;
    const cx = (fb.min.x + fb.max.x) / 2;
    const cy = (fb.min.y + fb.max.y) / 2;
    fp.forEach((a, i) => {
      const b = fp[(i + 1) % fp.length]!;
      const len = dist(a, b);
      if (len < 0.6) return;
      const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
      const ux = (b.x - a.x) / len;
      const uy = (b.y - a.y) / len;
      // Put the dimension on the side facing away from the building's centre.
      const side: 1 | -1 = (-uy * (mid.x - cx) + ux * (mid.y - cy)) * 1 >= 0 ? 1 : -1;
      body += dimensionLine(a, b, side, mm(9), formatLength(len, project.units), mm(2.6), mm(0.18));
    });
  }

  // Title, north arrow, scale bar.
  const titleY = box.y1 - mm(4);
  body += `<text x="${n(box.x0 + mm(4))}" y="${n(titleY - mm(11))}" font-size="${n(mm(4))}" font-weight="bold" font-family="Helvetica, Arial, sans-serif" fill="#0f172a">${esc(level?.name ?? '')}</text>`;
  body += scaleBar(box.x0 + mm(4), titleY - mm(5), S, mm);
  body += northArrow(box.x1 - mm(12), box.y0 + mm(12), project.settings.compass, mm);

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${n(widthMm)}mm" height="${n(heightMm)}mm" viewBox="${n(box.x0)} ${n(box.y0)} ${n(box.x1 - box.x0)} ${n(box.y1 - box.y0)}" font-family="Helvetica, Arial, sans-serif"><rect x="${n(box.x0)}" y="${n(box.y0)}" width="${n(box.x1 - box.x0)}" height="${n(box.y1 - box.y0)}" fill="#ffffff"/>${body}</svg>`;
  return { svg, box, widthMm, heightMm };
}

export const disclaimer = (): string => t('export.disclaimer');
