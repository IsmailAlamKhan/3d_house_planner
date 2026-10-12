import { BoxGeometry, type BufferGeometry } from 'three';
import { dist } from '../../geometry/vec';
import type { Opening, Wall } from '../../model/types';
import { type Part, mergeAll } from './common';
import { wallMatrix } from './walls';

const FRAME = 0.05;

const box = (w: number, h: number, d: number, x: number, y: number, z = 0): BoxGeometry => {
  const g = new BoxGeometry(w, h, d);
  g.translate(x, y, z);
  return g;
};

export interface OpeningBuildInput {
  opening: Opening;
  wall: Wall;
  /** Door leaves are drawn ajar when true, closed otherwise. */
  doorsOpen: boolean;
}

/** Frame (+ leaf for doors, glass for windows) for one opening, in level-local coordinates. */
export function generateOpeningParts({ opening: o, wall, doorsOpen }: OpeningBuildInput): Part[] {
  if (o.kind === 'archway') return [];
  const t = wall.thickness + 0.02;
  const cx = o.offset;
  const u0 = cx - o.width / 2;
  const u1 = cx + o.width / 2;
  const v0 = o.sillHeight;
  const v1 = Math.min(o.sillHeight + o.height, 1e9);
  const h = v1 - v0;
  const matrix = wallMatrix(wall);
  const entity = { type: 'opening' as const, id: o.id };
  const parts: Part[] = [];

  // Frame: two jambs + head (+ sill for windows).
  const frame: BufferGeometry[] = [
    box(FRAME, h, t, u0 + FRAME / 2, v0 + h / 2),
    box(FRAME, h, t, u1 - FRAME / 2, v0 + h / 2),
    box(o.width, FRAME, t, cx, v1 - FRAME / 2),
  ];
  if (o.kind === 'window') frame.push(box(o.width + 0.06, FRAME, t + 0.06, cx, v0 + FRAME / 2));
  const frameGeo = mergeAll(frame);
  if (frameGeo) {
    frameGeo.applyMatrix4(matrix);
    parts.push({
      id: `frame:${o.id}`,
      layer: 'frame',
      entity,
      geometry: frameGeo,
      materials: ['frame'],
      clipToCut: true,
    });
  }

  if (o.kind === 'window') {
    const glass = box(o.width - FRAME * 2, h - FRAME * 2, 0.012, cx, v0 + h / 2);
    glass.applyMatrix4(matrix);
    parts.push({
      id: `glass:${o.id}`,
      layer: 'frame',
      entity,
      geometry: glass,
      materials: ['glass'],
      clipToCut: true,
    });
    // A thin mullion down the middle makes wide windows read as casements.
    if (o.width > 1.0) {
      const m = box(0.03, h - FRAME * 2, 0.03, cx, v0 + h / 2);
      m.applyMatrix4(matrix);
      parts.push({
        id: `mullion:${o.id}`,
        layer: 'frame',
        entity,
        geometry: m,
        materials: ['frame'],
        clipToCut: true,
      });
    }
  } else {
    // Door leaf hinged on one jamb; `swing` picks the side, `flip` mirrors it, ajar by 18° when doors are open.
    const leafW = o.width - FRAME * 2;
    const leafH = h - FRAME;
    const hingeAtStart = (o.swing === 'right') === o.flip;
    const hingeU = hingeAtStart ? u0 + FRAME : u1 - FRAME;
    const leaf = box(leafW, leafH, 0.04, hingeAtStart ? leafW / 2 : -leafW / 2, leafH / 2);
    if (doorsOpen && o.swing !== 'none') {
      const angle = ((hingeAtStart ? -1 : 1) * 18 * Math.PI) / 180;
      leaf.rotateY(angle);
    }
    leaf.translate(hingeU, v0, 0);
    leaf.applyMatrix4(matrix);
    parts.push({
      id: `leaf:${o.id}`,
      layer: 'frame',
      entity,
      geometry: leaf,
      materials: ['leaf'],
      clipToCut: true,
    });
  }
  return parts;
}

export const wallLength = (w: Wall): number => dist(w.start, w.end);
