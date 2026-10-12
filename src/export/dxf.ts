import { clearArea } from '../checks/areas';
import { isVoidRoom } from '../checks/voidRoom';
import { getEntry, itemSize } from '../catalog';
import { boxCorners } from '../geometry/collide';
import { labelPoint, pointInPolygon } from '../geometry/polygon';
import { type Vec2 } from '../geometry/vec';
import { computeWallPolygons } from '../geometry/walls';
import type { Project } from '../model/types';
import { openingFrame } from '../plan2d/symbols';
import { layoutStair, stairFootprintPlan } from '../scene3d/generators/stairs';

/** Layers in the DXF with their AutoCAD colour index. */
export const DXF_LAYERS = [
  ['WALLS', 7],
  ['DOORS', 3],
  ['WINDOWS', 5],
  ['OPENINGS', 4],
  ['ROOMS', 2],
  ['ROOM_LABELS', 8],
  ['COLUMNS', 1],
  ['STAIRS', 6],
  ['FURNITURE', 9],
  ['SHELL', 8],
] as const;

type Layer = (typeof DXF_LAYERS)[number][0];

const MM = 1000;

/**
 * A small ASCII DXF (R12) writer. Coordinates are millimetres with y pointing up (the editor's y points down, so it
 * is flipped), which is what CAD programs expect.
 */
class Dxf {
  private body: string[] = [];
  private g(code: number, value: string | number) {
    this.body.push(String(code), String(value));
  }
  private pt(v: Vec2, base = 10) {
    this.g(base, (v.x * MM).toFixed(3));
    this.g(base + 10, (-v.y * MM).toFixed(3));
    this.g(base + 20, 0);
  }
  polyline(layer: Layer, pts: Vec2[], closed = true) {
    this.g(0, 'POLYLINE');
    this.g(8, layer);
    this.g(66, 1);
    this.g(70, closed ? 1 : 0);
    for (const p of pts) {
      this.g(0, 'VERTEX');
      this.g(8, layer);
      this.pt(p);
    }
    this.g(0, 'SEQEND');
    this.g(8, layer);
  }
  line(layer: Layer, a: Vec2, b: Vec2) {
    this.g(0, 'LINE');
    this.g(8, layer);
    this.pt(a, 10);
    this.g(11, (b.x * MM).toFixed(3));
    this.g(21, (-b.y * MM).toFixed(3));
    this.g(31, 0);
  }
  arc(layer: Layer, c: Vec2, r: number, startDeg: number, endDeg: number) {
    this.g(0, 'ARC');
    this.g(8, layer);
    this.pt(c);
    this.g(40, (r * MM).toFixed(3));
    this.g(50, startDeg.toFixed(3));
    this.g(51, endDeg.toFixed(3));
  }
  text(layer: Layer, at: Vec2, height: number, text: string) {
    this.g(0, 'TEXT');
    this.g(8, layer);
    this.pt(at);
    this.g(40, (height * MM).toFixed(3));
    this.g(1, text.replace(/[\r\n]+/g, ' '));
    this.g(72, 1); // centred
    this.g(11, (at.x * MM).toFixed(3));
    this.g(21, (-at.y * MM).toFixed(3));
    this.g(31, 0);
  }
  toString(): string {
    const head = [
      0,
      'SECTION',
      2,
      'HEADER',
      9,
      '$ACADVER',
      1,
      'AC1009',
      9,
      '$INSUNITS',
      70,
      4,
      0,
      'ENDSEC',
      0,
      'SECTION',
      2,
      'TABLES',
      0,
      'TABLE',
      2,
      'LAYER',
      70,
      DXF_LAYERS.length,
    ];
    for (const [name, color] of DXF_LAYERS)
      head.push(0, 'LAYER', 2, name, 70, 0, 62, color, 6, 'CONTINUOUS');
    head.push(0, 'ENDTAB', 0, 'ENDSEC', 0, 'SECTION', 2, 'ENTITIES');
    return [...head.map(String), ...this.body, '0', 'ENDSEC', '0', 'EOF', ''].join('\n');
  }
}

/** DXF of one level: walls, openings (door swings), rooms with labels, columns, stairs, furniture and the shell outline. */
export function planDxf(project: Project, levelId: string): string {
  const dxf = new Dxf();
  dxf.polyline('SHELL', project.shell.footprint);
  const walls = project.walls.filter((w) => w.levelId === levelId);
  const polys = computeWallPolygons(walls);
  for (const w of walls) {
    const poly = polys.get(w.id);
    if (poly) dxf.polyline('WALLS', poly);
  }
  const wallById = new Map(walls.map((w) => [w.id, w]));
  for (const o of project.openings) {
    const wall = wallById.get(o.wallId);
    if (!wall) continue;
    const { center, angle } = openingFrame(o, wall);
    const a = (angle * Math.PI) / 180;
    const ux = Math.cos(a);
    const uy = Math.sin(a);
    const hw = o.width / 2;
    const ht = wall.thickness / 2;
    const corner = (sx: number, sy: number): Vec2 => ({
      x: center.x + ux * hw * sx - uy * ht * sy,
      y: center.y + uy * hw * sx + ux * ht * sy,
    });
    const layer: Layer = o.kind === 'door' ? 'DOORS' : o.kind === 'window' ? 'WINDOWS' : 'OPENINGS';
    dxf.polyline(layer, [corner(-1, -1), corner(1, -1), corner(1, 1), corner(-1, 1)]);
    if (o.kind === 'door' && o.swing !== 'none') {
      // Leaf and swing arc about the hinge (hinge side follows the swing, mirrored by `flip`); opens toward the inside.
      const hingeSide = (o.swing === 'left') !== o.flip ? -1 : 1;
      const hinge = corner(hingeSide, 0);
      const closed: Vec2 = { x: ux * -hingeSide, y: uy * -hingeSide }; // leaf direction when shut
      const cand = (k: 1 | -1): Vec2 => ({ x: -closed.y * k, y: closed.x * k });
      const inside = (k: 1 | -1) =>
        pointInPolygon(
          { x: hinge.x + cand(k).x * o.width * 0.7, y: hinge.y + cand(k).y * o.width * 0.7 },
          project.shell.footprint,
        );
      const k: 1 | -1 = inside(1) || !inside(-1) ? 1 : -1;
      const open = cand(k);
      dxf.line('DOORS', hinge, { x: hinge.x + open.x * o.width, y: hinge.y + open.y * o.width });
      const deg = (v: Vec2) => (Math.atan2(-v.y, v.x) * 180) / Math.PI; // angle in the flipped (y-up) frame
      const a0 = deg(closed);
      const a1 = deg(open);
      // Plan rotation by +90° is -90° after the flip, so the counter-clockwise sweep runs from `open` to `closed`.
      const [from, to] = k === 1 ? [a1, a0] : [a0, a1];
      dxf.arc('DOORS', hinge, o.width, ((from % 360) + 360) % 360, ((to % 360) + 360) % 360);
    }
  }
  for (const r of project.rooms.filter((x) => x.levelId === levelId && !isVoidRoom(project, x))) {
    dxf.polyline('ROOMS', r.polygon);
    const c = labelPoint(r.polygon);
    dxf.text('ROOM_LABELS', c, 0.18, r.name);
    dxf.text(
      'ROOM_LABELS',
      { x: c.x, y: c.y + 0.32 },
      0.14,
      `${clearArea(project, r).toFixed(1)} m2`,
    );
  }
  for (const c of project.columns.filter((k) => k.levelId === levelId)) {
    const hw = c.size.w / 2;
    const hd = c.size.d / 2;
    dxf.polyline('COLUMNS', [
      { x: c.position.x - hw, y: c.position.y - hd },
      { x: c.position.x + hw, y: c.position.y - hd },
      { x: c.position.x + hw, y: c.position.y + hd },
      { x: c.position.x - hw, y: c.position.y + hd },
    ]);
  }
  for (const stair of project.stairs.filter((s) => s.fromLevelId === levelId)) {
    const from = project.levels.find((l) => l.id === stair.fromLevelId);
    const to = project.levels.find((l) => l.id === stair.toLevelId);
    if (!from || !to) continue;
    for (const poly of stairFootprintPlan(stair, layoutStair(stair, from, to)))
      dxf.polyline('STAIRS', poly);
  }
  for (const it of project.items.filter((i) => i.levelId === levelId)) {
    const entry = getEntry(it.catalogId);
    if (!entry) continue;
    const size = itemSize(entry, it.scale);
    dxf.polyline('FURNITURE', boxCorners(it.position, size.w, size.d, it.rotation));
  }
  return dxf.toString();
}
