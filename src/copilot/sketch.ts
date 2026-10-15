import { extract } from '../ai/vision/extract';
import type { VisionClient } from '../ai/vision/client';
import { canvasSource } from '../ai/vision/source';
import type { Rect } from '../ai/layout/plan';
import type { BriefRoom, DesignBrief, RoomType } from '../model/types';
import { roomTypeOfLabel } from './commands';
import { emptyBrief, makeRoom } from './program';

/** A rough room box on a sketch, in 0–1 coordinates of the sketch (x to the right, y down). */
export interface SketchBox {
  name: string;
  type?: RoomType;
  x: number;
  y: number;
  w: number;
  h: number;
}

/**
 * A hand sketch (photo or boxes drawn in the app) as a brief: the rooms with their proportions, and a placement
 * hint at each box's centre mapped onto the shell, so the layout engine keeps the person's arrangement and only
 * tidies it (aligned walls, doors, windows, stair).
 */
export function sketchToBrief(
  boxes: SketchBox[],
  shell: Rect,
  opts: { villa?: boolean } = {},
): { brief: DesignBrief; notes: string[] } {
  const notes: string[] = [];
  const real = boxes.filter((b) => b.w > 0.02 && b.h > 0.02);
  const total = real.reduce((s, b) => s + b.w * b.h, 0) || 1;
  const usable = shell.w * shell.h * 0.86;
  // Fit the drawing onto the shell: use its own bounding box so a sketch drawn small still fills the plan.
  const minX = Math.min(...real.map((b) => b.x));
  const minY = Math.min(...real.map((b) => b.y));
  const maxX = Math.max(...real.map((b) => b.x + b.w));
  const maxY = Math.max(...real.map((b) => b.y + b.h));
  const sw = Math.max(1e-6, maxX - minX);
  const sh = Math.max(1e-6, maxY - minY);
  const program: BriefRoom[] = [];
  const hints: DesignBrief['hints'] = {};
  const used = new Map<string, number>();
  for (const b of real) {
    const type = b.type ?? roomTypeOfLabel(b.name) ?? 'other';
    let name = b.name.trim() || type;
    const n = (used.get(name.toLowerCase()) ?? 0) + 1;
    used.set(name.toLowerCase(), n);
    if (n > 1) name = `${name} ${n}`;
    const room = makeRoom(type, {
      name,
      area: Math.max(2.5, Math.min(120, ((b.w * b.h) / total) * usable)),
    });
    program.push(room);
    hints[room.id] = {
      x: shell.x + ((b.x + b.w / 2 - minX) / sw) * shell.w,
      y: shell.y + ((b.y + b.h / 2 - minY) / sh) * shell.h,
    };
  }
  if (!program.some((r) => r.type === 'bathroom')) {
    program.push(makeRoom('bathroom', { area: 5 }));
    notes.push('The sketch has no bathroom: one was added.');
  }
  if (!program.some((r) => r.type === 'kitchen')) notes.push('The sketch has no kitchen.');
  const brief = emptyBrief({
    title: 'From a sketch',
    kind: opts.villa ? 'villa' : 'duplex',
    levels: 1,
    program,
    hints,
    assumptions: [{ key: 'sketch', text: 'The arrangement of rooms follows your sketch' }],
  });
  return { brief, notes };
}

/** Rooms the vision model read from a photo of a hand-drawn plan (it finds labelled regions and their boxes). */
export async function readSketchPhoto(
  canvas: HTMLCanvasElement,
  client: VisionClient,
  signal?: AbortSignal,
): Promise<{ boxes: SketchBox[]; notes: string[] }> {
  const source = canvasSource(canvas);
  const x = await extract({ client, source, signal, labelPasses: 'whole' });
  const boxes: SketchBox[] = x.candidates
    .filter((c) => c.kind === 'room')
    .map((c) => ({
      name: c.name,
      type: c.type as RoomType | undefined,
      x: c.box[0] / source.width,
      y: c.box[1] / source.height,
      w: (c.box[2] - c.box[0]) / source.width,
      h: (c.box[3] - c.box[1]) / source.height,
    }));
  return { boxes, notes: x.notes };
}
