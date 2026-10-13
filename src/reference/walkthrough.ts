import { distanceToPolygon } from '../checks/site';
import { type Vec2 } from '../geometry/vec';
import type { Project } from '../model/types';
import { wallLength } from '../model/integrity';

export interface Walkthrough {
  /** What the walk from the pedestrian gate can reach, by name. */
  reached: string[];
  /** What it cannot: rooms (no door chain) and outdoor areas (no way across the garden). */
  unreached: string[];
  /** Total number of rooms and outdoor areas considered. */
  total: number;
}

/** People can step across a gap this wide (m) between two outdoor areas (a 2.5 ft strip of planting). */
const STEP_ACROSS = 0.76;
/** A door opens onto an outdoor area when it is this close (m). */
const DOOR_REACH = 0.5;
/** Narrower than this (m) is not a place to walk to. */
const MIN_WIDTH = 0.8;

/**
 * Can a person walk from the pedestrian gate to every room, to the pool deck and to the roof terrace? A room is
 * reached through doors and archways (and the staircase between floors); an outdoor area through the gate, through an
 * outside door, or by stepping across from the area next to it. Windows are not ways in.
 */
export function walkthrough(project: Project): Walkthrough {
  const rooms = project.rooms;
  // Planting beds and narrow strips (stepping stones along the wall) are not places to walk to.
  const walkable = (z: Project['site']['zones'][number]) => {
    if (z.type === 'garden') return false;
    const xs = z.polygon.map((p) => p.x);
    const ys = z.polygon.map((p) => p.y);
    return (
      Math.min(Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys)) >= MIN_WIDTH
    );
  };
  const zones = project.site.zones.filter(walkable);
  const nodes = new Map<string, string>(); // id → name
  for (const r of rooms) nodes.set(`room:${r.id}`, r.name);
  for (const z of zones) nodes.set(`zone:${z.id}`, z.name);
  const adj = new Map<string, Set<string>>();
  const link = (a: string, b: string) => {
    if (a === b) return;
    (adj.get(a) ?? adj.set(a, new Set()).get(a)!).add(b);
    (adj.get(b) ?? adj.set(b, new Set()).get(b)!).add(a);
  };

  // Doors: between two rooms, or from a room out to the zones beside the door.
  for (const o of project.openings) {
    if (o.kind === 'window') continue;
    const wall = project.walls.find((w) => w.id === o.wallId);
    if (!wall) continue;
    const len = wallLength(wall) || 1;
    const dx = (wall.end.x - wall.start.x) / len;
    const dy = (wall.end.y - wall.start.y) / len;
    const c: Vec2 = { x: wall.start.x + dx * o.offset, y: wall.start.y + dy * o.offset };
    const k = wall.thickness / 2 + 0.12;
    const side = (s: number) => ({ x: c.x - dy * k * s, y: c.y + dx * k * s });
    const roomAt = (p: Vec2) =>
      rooms.find((r) => r.levelId === wall.levelId && pointIn(p, r.polygon));
    const a = roomAt(side(1));
    const b = roomAt(side(-1));
    if (a && b) link(`room:${a.id}`, `room:${b.id}`);
    for (const room of [a, b]) {
      if (!room || (a && b)) continue;
      for (const z of zones)
        if (distanceToPolygon(c, z.polygon) <= DOOR_REACH) link(`room:${room.id}`, `zone:${z.id}`);
    }
  }

  // The staircase joins the rooms it starts and ends in.
  for (const s of project.stairs) {
    const lower = rooms.find((r) => r.levelId === s.fromLevelId && pointIn(s.position, r.polygon));
    const along = { x: Math.cos(s.rotation), y: Math.sin(s.rotation) };
    const top = { x: s.position.x + along.x * 3, y: s.position.y + along.y * 3 };
    const upper = rooms.find(
      (r) =>
        r.levelId === s.toLevelId &&
        (pointIn(top, r.polygon) || pointIn(s.position, r.polygon) || nearPoly(top, r.polygon)),
    );
    if (lower && upper) link(`room:${lower.id}`, `room:${upper.id}`);
  }

  // Outdoors: areas that touch, or are only a step apart.
  for (let i = 0; i < zones.length; i++)
    for (let j = i + 1; j < zones.length; j++) {
      const a = zones[i]!;
      const b = zones[j]!;
      if (a.polygon.some((p) => distanceToPolygon(p, b.polygon) <= STEP_ACROSS))
        link(`zone:${a.id}`, `zone:${b.id}`);
      else if (b.polygon.some((p) => distanceToPolygon(p, a.polygon) <= STEP_ACROSS))
        link(`zone:${a.id}`, `zone:${b.id}`);
    }

  // Start: the zones at the gates (the pedestrian gate leads to the entrance, the vehicle gate to the car port).
  const start = new Set<string>();
  for (const g of project.site.gates)
    for (const z of zones)
      if (distanceToPolygon(g.position, z.polygon) <= 1) start.add(`zone:${z.id}`);
  const seen = new Set(start);
  const queue = [...start];
  while (queue.length) {
    for (const n of adj.get(queue.shift()!) ?? [])
      if (!seen.has(n)) {
        seen.add(n);
        queue.push(n);
      }
  }
  const reached: string[] = [];
  const unreached: string[] = [];
  for (const [id, name] of nodes) (seen.has(id) ? reached : unreached).push(name);
  return { reached, unreached, total: nodes.size };
}

function pointIn(p: Vec2, poly: Vec2[]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i]!;
    const b = poly[j]!;
    if (a.y > p.y !== b.y > p.y && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x)
      inside = !inside;
  }
  return inside;
}

const nearPoly = (p: Vec2, poly: Vec2[]): boolean => distanceToPolygon(p, poly) < 0.6;
