import { jsPDF } from 'jspdf';
import { areaSchedule } from '../checks/areas';
import { isVoidRoom } from '../checks/voidRoom';
import { t } from '../i18n';
import { materialDefName, resolveDef } from '../materials';
import { faceTowardRoom, wallsAroundRoom } from '../model/ops';
import type { Project, Room } from '../model/types';
import { formatArea } from '../ui/units';
import { type PlanScale, mmPerMetre, planSvg } from './planSvg';

export type Paper = 'auto' | 'a4' | 'a3' | 'a2';

export interface PdfOptions {
  scale: PlanScale;
  paper?: Paper;
  /** Data URL (png/jpeg) of the 3D view for the cover. */
  hero?: string;
  /** Only these levels (default: all). */
  levelIds?: string[];
  /** Draw furniture on the plans. */
  furniture?: boolean;
  date?: Date;
}

/** Where a drawing was placed on a page, in millimetres — what makes "1:50" checkable. */
export interface Placement {
  page: number;
  levelId: string;
  x: number;
  y: number;
  widthMm: number;
  heightMm: number;
  scale: PlanScale;
}

export interface PdfResult {
  data: ArrayBuffer;
  pages: number;
  placements: Placement[];
}

const SIZES: Record<Exclude<Paper, 'auto'>, [number, number]> = {
  a4: [210, 297],
  a3: [297, 420],
  a2: [420, 594],
};

const MARGIN = 10;
const HEADER = 14;
const FOOTER = 10;

/** Smallest standard sheet (portrait or landscape) the drawing fits on, or null if it fits none. */
export function choosePaper(
  widthMm: number,
  heightMm: number,
  paper: Paper = 'auto',
): { w: number; h: number; orientation: 'p' | 'l'; name: string; fits: boolean } {
  const needW = widthMm + MARGIN * 2;
  const needH = heightMm + HEADER + FOOTER + MARGIN;
  const names = paper === 'auto' ? (['a4', 'a3', 'a2'] as const) : ([paper] as const);
  for (const name of names) {
    const [a, b] = SIZES[name];
    if (needW <= a && needH <= b) return { w: a, h: b, orientation: 'p', name, fits: true };
    if (needW <= b && needH <= a) return { w: b, h: a, orientation: 'l', name, fits: true };
  }
  // Does not fit: use the largest allowed sheet in the orientation that wastes least; the caller warns.
  const name = names[names.length - 1]!;
  const [a, b] = SIZES[name];
  return needW > needH
    ? { w: b, h: a, orientation: 'l', name, fits: false }
    : { w: a, h: b, orientation: 'p', name, fits: false };
}

export type SvgRenderer = (
  doc: jsPDF,
  svg: string,
  box: { x: number; y: number; width: number; height: number },
) => Promise<void>;

/** Draws SVG into the PDF with svg2pdf.js (browser only). */
export const renderSvgWithSvg2Pdf: SvgRenderer = async (doc, svg, box) => {
  const { svg2pdf } = await import('svg2pdf.js');
  const host = document.createElement('div');
  host.style.cssText = 'position:fixed;left:-99999px;top:0;visibility:hidden';
  host.innerHTML = svg;
  document.body.appendChild(host);
  try {
    await svg2pdf(host.firstElementChild as SVGElement, doc, box);
  } finally {
    host.remove();
  }
};

function wallFinishes(project: Project, room: Room): string[] {
  const names = new Set<string>();
  for (const w of wallsAroundRoom(project, room)) {
    const field = faceTowardRoom(project, w, room);
    if (field) names.add(materialDefName(resolveDef(w[field])));
  }
  return [...names];
}

/**
 * Plan set PDF: cover, one plan per level to scale, the area schedule and the room-by-room materials list, with the
 * "indicative only" disclaimer in the footer of every page.
 */
export async function buildPdf(
  project: Project,
  opts: PdfOptions,
  render: SvgRenderer = renderSvgWithSvg2Pdf,
): Promise<PdfResult> {
  const doc = new jsPDF({ unit: 'mm', format: 'a4', orientation: 'p' });
  const placements: Placement[] = [];
  const date = (opts.date ?? new Date()).toISOString().slice(0, 10);
  const levels = [...project.levels]
    .sort((a, b) => a.index - b.index)
    .filter((l) => !opts.levelIds || opts.levelIds.includes(l.id));

  // ── Cover ──
  doc.setFont('helvetica', 'bold').setFontSize(26).setTextColor(15, 23, 42);
  doc.text(project.name, 105, 40, { align: 'center', maxWidth: 180 });
  doc.setFont('helvetica', 'normal').setFontSize(12).setTextColor(71, 85, 105);
  doc.text(`${t('export.planSet')} · ${date}`, 105, 50, { align: 'center' });
  if (opts.hero) {
    const props = doc.getImageProperties(opts.hero);
    const maxW = 180;
    const maxH = 150;
    const k = Math.min(maxW / props.width, maxH / props.height);
    const w = props.width * k;
    const h = props.height * k;
    doc.addImage(opts.hero, props.fileType, 105 - w / 2, 62, w, h);
  }
  const sched = areaSchedule(project);
  doc.setFontSize(11).setTextColor(30, 41, 59);
  const summary = [
    `${t('export.levels')}: ${levels.map((l) => l.name).join(', ')}`,
    `${t('export.usable')}: ${formatArea(sched.total.usable, project.units)}`,
    `${t('export.scale')}: 1:${opts.scale}`,
  ];
  summary.forEach((line, i) => doc.text(line, 105, 232 + i * 7, { align: 'center' }));

  // ── Plans ──
  for (const level of levels) {
    const plan = planSvg(project, level.id, { scale: opts.scale, furniture: opts.furniture });
    const paper = choosePaper(plan.widthMm, plan.heightMm, opts.paper);
    doc.addPage([paper.w, paper.h], paper.orientation === 'p' ? 'portrait' : 'landscape');
    doc.setFont('helvetica', 'bold').setFontSize(13).setTextColor(15, 23, 42);
    doc.text(`${project.name} — ${level.name}`, MARGIN, MARGIN + 4);
    doc.setFont('helvetica', 'normal').setFontSize(9).setTextColor(100, 116, 139);
    doc.text(
      `${t('export.scale')} 1:${opts.scale}${paper.fits ? '' : ` — ${t('export.noFit')}`}`,
      paper.w - MARGIN,
      MARGIN + 4,
      { align: 'right' },
    );
    const x = MARGIN;
    const y = MARGIN + HEADER - 4;
    // The drawing is placed at its exact size, so 1 m of building is 1000/scale mm of paper.
    await render(doc, plan.svg, { x, y, width: plan.widthMm, height: plan.heightMm });
    placements.push({
      page: doc.getNumberOfPages(),
      levelId: level.id,
      x,
      y,
      widthMm: plan.widthMm,
      heightMm: plan.heightMm,
      scale: opts.scale,
    });
  }

  // ── Area schedule ──
  doc.addPage('a4', 'portrait');
  let y = 22;
  const heading = (text: string) => {
    doc.setFont('helvetica', 'bold').setFontSize(14).setTextColor(15, 23, 42);
    doc.text(text, MARGIN, y);
    y += 8;
  };
  const row = (cols: string[], xs: number[], bold = false) => {
    if (y > 270) {
      doc.addPage('a4', 'portrait');
      y = 22;
    }
    doc
      .setFont('helvetica', bold ? 'bold' : 'normal')
      .setFontSize(9)
      .setTextColor(30, 41, 59);
    cols.forEach((c, i) =>
      doc.text(c, xs[i]!, y, { align: i === 0 ? 'left' : 'right', maxWidth: 80 }),
    );
    y += 5.5;
  };
  heading(t('export.areaSchedule'));
  const ax = [MARGIN, 110, 140, 170, 200];
  row(
    [t('export.level'), t('areas.gross'), t('areas.usable'), t('areas.walls'), t('areas.void')],
    ax,
    true,
  );
  for (const l of sched.levels.filter((x) => levels.some((v) => v.id === x.levelId)))
    row(
      [
        l.name,
        formatArea(l.gross, project.units),
        formatArea(l.usable, project.units),
        formatArea(l.walls, project.units),
        formatArea(l.openVoid, project.units),
      ],
      ax,
    );
  row(
    [
      t('areas.total'),
      formatArea(sched.total.gross, project.units),
      formatArea(sched.total.usable, project.units),
      formatArea(sched.total.walls, project.units),
      '',
    ],
    ax,
    true,
  );
  y += 6;
  heading(t('export.rooms'));
  const rx = [MARGIN, 110, 150, 200];
  row([t('export.room'), t('export.level'), t('export.type'), t('areas.usable')], rx, true);
  for (const l of sched.levels.filter((x) => levels.some((v) => v.id === x.levelId)))
    for (const r of l.rooms) row([r.name, l.name, r.type, formatArea(r.area, project.units)], rx);

  // ── Materials ──
  doc.addPage('a4', 'portrait');
  y = 22;
  heading(t('export.materials'));
  const mx = [MARGIN, 52, 92, 132, 200];
  row(
    [t('export.room'), t('export.floor'), t('export.ceiling'), t('export.wallsFinish')],
    mx.slice(0, 4),
    true,
  );
  for (const level of levels)
    for (const r of project.rooms.filter((x) => x.levelId === level.id && !isVoidRoom(project, x)))
      row(
        [
          `${r.name} (${level.name})`,
          materialDefName(resolveDef(r.floorMaterial)),
          materialDefName(resolveDef(r.ceilingMaterial)),
          wallFinishes(project, r).join(', ') || '—',
        ],
        mx.slice(0, 4),
      );

  // ── Footer on every page ──
  const total = doc.getNumberOfPages();
  for (let i = 1; i <= total; i++) {
    doc.setPage(i);
    const w = doc.internal.pageSize.getWidth();
    const h = doc.internal.pageSize.getHeight();
    doc
      .setDrawColor(203, 213, 225)
      .setLineWidth(0.2)
      .line(MARGIN, h - 11, w - MARGIN, h - 11);
    doc.setFont('helvetica', 'italic').setFontSize(8).setTextColor(100, 116, 139);
    doc.text(t('export.disclaimer'), MARGIN, h - 6);
    doc.setFont('helvetica', 'normal');
    doc.text(`${i} / ${total}`, w - MARGIN, h - 6, { align: 'right' });
  }

  return { data: doc.output('arraybuffer'), pages: total, placements };
}

export { mmPerMetre };
