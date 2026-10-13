import { entryName, getEntry, itemSize } from '../../catalog';
import { placeExistingItem, placeItem, placeOnWall } from '../../catalog/placement';
import { pointInPolygon } from '../../geometry/polygon';
import { fmtNum, t } from '../../i18n';
import * as ops from '../../model/ops';
import { ModelError } from '../../model/ops';
import type { Project, Room } from '../../model/types';
import type { EditOperation, Side } from '../schemas';
import { EditError, findCatalogEntry, findMaterial, resolveLevel, resolveRoom } from './lookup';
import { axisOf, moveWallLine, oppositeSide, outward, roomBox, wallOnSide } from './walls';
import { exteriorSides } from './sides';

export interface EditContext {
  /** Level the user is looking at; used to pick between rooms with the same name. */
  activeLevelId: string;
}

const fmt = (m: number) => `${fmtNum(Math.abs(m), 1)} ${t('unit.m')}`;
const sideWord = (s: Side) => s;

function applyOne(p: Project, op: EditOperation, ctx: EditContext): void {
  switch (op.op) {
    case 'resizeRoom': {
      const room = resolveRoom(p, op.room, ctx.activeLevelId);
      const box = roomBox(room);
      if (!box.rectangular) throw new EditError(t('ai.edit.notRect').replace('{room}', room.name));
      const axis = op.dimension === 'width' ? 'x' : 'y';
      const current = axis === 'x' ? box.max.x - box.min.x : box.max.y - box.min.y;
      const target = op.to ?? current + (op.delta ?? 0);
      if (op.to === undefined && op.delta === undefined)
        throw new EditError(t('ai.edit.needAmount'));
      const change = target - current;
      if (Math.abs(change) < 1e-3) return;
      const sides: [Side, Side] = axis === 'x' ? ['west', 'east'] : ['north', 'south'];
      // The side that stays put: the one asked for, otherwise an outer wall, otherwise the near side.
      const outer = exteriorSides(p, room);
      const anchor: Side =
        op.anchor && sides.includes(op.anchor)
          ? op.anchor
          : (sides.find((s) => outer.includes(s)) ?? sides[0]);
      const moving = oppositeSide(anchor);
      const wall = wallOnSide(p, room, moving);
      if (!wall)
        throw new EditError(
          t('ai.edit.noWall').replace('{side}', sideWord(moving)).replace('{room}', room.name),
        );
      const o = outward(moving);
      moveWallLine(p, wall, o.x * change, o.y * change, room.name, sideWord(moving));
      return;
    }
    case 'moveWall': {
      const room = resolveRoom(p, op.room, ctx.activeLevelId);
      const wall = wallOnSide(p, room, op.side);
      if (!wall)
        throw new EditError(
          t('ai.edit.noWall').replace('{side}', sideWord(op.side)).replace('{room}', room.name),
        );
      const o = outward(op.side);
      moveWallLine(p, wall, o.x * op.distance, o.y * op.distance, room.name, sideWord(op.side));
      return;
    }
    case 'addRoom': {
      const from = resolveRoom(p, op.from, ctx.activeLevelId);
      const box = roomBox(from);
      if (!box.rectangular) throw new EditError(t('ai.edit.notRect').replace('{room}', from.name));
      const { min, max } = box;
      const horizontal = op.side === 'north' || op.side === 'south';
      const total = horizontal ? max.y - min.y : max.x - min.x;
      if (op.size > total - 1.0)
        throw new EditError(
          t('ai.edit.tooSmall').replace('{room}', from.name).replace('{min}', '1.0'),
        );
      const cut =
        op.side === 'north'
          ? min.y + op.size
          : op.side === 'south'
            ? max.y - op.size
            : op.side === 'west'
              ? min.x + op.size
              : max.x - op.size;
      const a = horizontal ? { x: min.x, y: cut } : { x: cut, y: min.y };
      const b = horizontal ? { x: max.x, y: cut } : { x: cut, y: max.y };
      const keep = {
        name: from.name,
        type: from.type,
        floor: from.floorMaterial,
        ceiling: from.ceilingMaterial,
      };
      ops.addWallChain(p, from.levelId, [a, b], { wall: { type: 'interior' } });
      const stripCenter = horizontal
        ? { x: (min.x + max.x) / 2, y: op.side === 'north' ? (min.y + cut) / 2 : (cut + max.y) / 2 }
        : { x: op.side === 'west' ? (min.x + cut) / 2 : (cut + max.x) / 2, y: (min.y + max.y) / 2 };
      const strip = p.rooms.find(
        (r) => r.levelId === from.levelId && pointInPolygon(stripCenter, r.polygon),
      );
      const rest = p.rooms.find(
        (r) =>
          r.levelId === from.levelId &&
          r !== strip &&
          pointInPolygon(
            {
              x:
                (min.x + max.x) / 2 +
                (horizontal ? 0 : op.side === 'west' ? op.size / 2 : -op.size / 2),
              y:
                (min.y + max.y) / 2 +
                (horizontal ? (op.side === 'north' ? op.size / 2 : -op.size / 2) : 0),
            },
            r.polygon,
          ),
      );
      if (!strip)
        throw new EditError(t('ai.edit.wouldBreak').replace('{why}', t('ai.edit.noSplit')));
      strip.name = op.name;
      strip.type = op.type;
      if (rest) {
        rest.name = keep.name;
        rest.type = keep.type;
        rest.floorMaterial = keep.floor;
        rest.ceilingMaterial = keep.ceiling;
      }
      // A door between the two (centre of the new wall, if it is long enough).
      const wall = p.walls.find(
        (w) =>
          w.levelId === from.levelId &&
          Math.abs((w.start.x + w.end.x) / 2 - (a.x + b.x) / 2) < 0.6 &&
          Math.abs((w.start.y + w.end.y) / 2 - (a.y + b.y) / 2) < 0.6 &&
          (horizontal
            ? Math.abs(w.start.y - cut) < 1e-3 && Math.abs(w.end.y - cut) < 1e-3
            : Math.abs(w.start.x - cut) < 1e-3 && Math.abs(w.end.x - cut) < 1e-3),
      );
      const entry = getEntry('door-single')!;
      if (wall && Math.hypot(wall.end.x - wall.start.x, wall.end.y - wall.start.y) >= 1.3) {
        const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
        const r = placeOnWall(p, from.levelId, entry, mid, { wallId: wall.id });
        if (r.ok)
          ops.addOpening(p, {
            wallId: r.wallId,
            offset: r.offset,
            kind: 'door',
            catalogId: 'door-single',
            width: r.width,
            height: r.height,
            sillHeight: 0,
            swing: 'left',
          });
      }
      return;
    }
    case 'removeRoom': {
      const room = resolveRoom(p, op.room, ctx.activeLevelId);
      mergeAway(
        p,
        room,
        op.mergeInto ? resolveRoom(p, op.mergeInto, ctx.activeLevelId) : undefined,
      );
      return;
    }
    case 'renameRoom': {
      const room = resolveRoom(p, op.room, ctx.activeLevelId);
      ops.updateRoom(p, room.id, {
        ...(op.name ? { name: op.name } : {}),
        ...(op.type ? { type: op.type } : {}),
      });
      return;
    }
    case 'changeMaterial': {
      const id = findMaterial(op.material, op.target);
      if (!id) throw new EditError(t('ai.edit.noMaterial').replace('{material}', op.material));
      const rooms: Room[] = op.room
        ? [resolveRoom(p, op.room, ctx.activeLevelId)]
        : op.level
          ? p.rooms.filter((r) => r.levelId === resolveLevel(p, op.level, ctx.activeLevelId).id)
          : p.rooms.slice();
      for (const r of rooms) {
        if (op.target === 'floor') ops.updateRoom(p, r.id, { floorMaterial: id });
        else if (op.target === 'ceiling') ops.updateRoom(p, r.id, { ceilingMaterial: id });
        else ops.paintRoomWalls(p, r.id, id);
      }
      return;
    }
    case 'addItem': {
      const room = resolveRoom(p, op.room, ctx.activeLevelId);
      const entry = findCatalogEntry(op.catalogId);
      if (!entry) throw new EditError(t('ai.edit.noItem').replace('{item}', op.catalogId));
      if (entry.placement === 'wall') {
        // Doors/windows asked for through addItem: put one on the first free outer wall.
        throw new EditError(
          t('ai.edit.useOpening').replace('{item}', entryName(entry)),
        );
      }
      for (let i = 0; i < (op.count ?? 1); i++) {
        const spot = findFreeSpot(p, room, entry.catalogId);
        if (!spot)
          throw new EditError(
            t('ai.edit.noSpace')
              .replace('{item}', entryName(entry).toLowerCase())
              .replace('{room}', room.name),
          );
        ops.addItem(p, {
          levelId: room.levelId,
          catalogId: entry.catalogId,
          position: spot.position,
          rotation: spot.rotation,
          elevation: spot.elevation,
        });
      }
      return;
    }
    case 'removeItem': {
      const entry = findCatalogEntry(op.catalogId);
      if (!entry) throw new EditError(t('ai.edit.noItem').replace('{item}', op.catalogId));
      const room = op.room ? resolveRoom(p, op.room, ctx.activeLevelId) : undefined;
      const hits = p.items.filter(
        (i) =>
          i.catalogId === entry.catalogId &&
          (room
            ? i.levelId === room.levelId && pointInPolygon(i.position, room.polygon)
            : i.levelId === ctx.activeLevelId),
      );
      if (!hits.length)
        throw new EditError(
          t('ai.edit.noItemFound')
            .replace('{item}', entryName(entry).toLowerCase())
            .replace('{room}', room?.name ?? t('ai.edit.thisLevel')),
        );
      ops.deleteSelection(p, { type: 'item', ids: hits.map((h) => h.id) });
      return;
    }
    case 'moveItem': {
      const entry = findCatalogEntry(op.catalogId);
      if (!entry) throw new EditError(t('ai.edit.noItem').replace('{item}', op.catalogId));
      const room = op.room ? resolveRoom(p, op.room, ctx.activeLevelId) : undefined;
      const item = p.items.find(
        (i) =>
          i.catalogId === entry.catalogId &&
          (room
            ? i.levelId === room.levelId && pointInPolygon(i.position, room.polygon)
            : i.levelId === ctx.activeLevelId),
      );
      if (!item)
        throw new EditError(
          t('ai.edit.noItemFound')
            .replace('{item}', entryName(entry).toLowerCase())
            .replace('{room}', room?.name ?? t('ai.edit.thisLevel')),
        );
      const r = placeExistingItem(p, item, {
        x: item.position.x + (op.dx ?? 0),
        y: item.position.y + (op.dy ?? 0),
      });
      if (!r.ok) throw new EditError(r.message);
      ops.updateItem(p, item.id, {
        position: r.position,
        rotation: r.rotation,
        elevation: r.elevation,
      });
      return;
    }
    case 'addOpening': {
      const room = resolveRoom(p, op.room, ctx.activeLevelId);
      const box = roomBox(room);
      const wall = wallOnSide(p, room, op.side);
      if (!wall)
        throw new EditError(
          t('ai.edit.noWall').replace('{side}', op.side).replace('{room}', room.name),
        );
      const entry =
        (op.catalogId ? findCatalogEntry(op.catalogId) : undefined) ??
        getEntry(
          op.kind === 'window'
            ? 'window-casement'
            : op.kind === 'archway'
              ? 'archway'
              : 'door-single',
        )!;
      const mid =
        op.side === 'north'
          ? { x: (box.min.x + box.max.x) / 2, y: box.min.y }
          : op.side === 'south'
            ? { x: (box.min.x + box.max.x) / 2, y: box.max.y }
            : op.side === 'west'
              ? { x: box.min.x, y: (box.min.y + box.max.y) / 2 }
              : { x: box.max.x, y: (box.min.y + box.max.y) / 2 };
      const r = placeOnWall(p, room.levelId, entry, mid, { wallId: wall.id });
      if (!r.ok) throw new EditError(r.message);
      ops.addOpening(p, {
        wallId: r.wallId,
        offset: r.offset,
        kind: op.kind,
        catalogId: entry.catalogId,
        width: r.width,
        height: r.height,
        sillHeight: r.sillHeight,
        swing: op.kind === 'door' ? 'left' : 'none',
      });
      return;
    }
    case 'changeStairType': {
      if (!p.stairs.length) throw new EditError(t('ai.edit.noStair'));
      for (const s of p.stairs) ops.updateStair(p, s.id, { type: op.type });
      return;
    }
  }
}

/** A spot for a new item inside a room that placement rules accept (preferring one without clearance warnings). */
function findFreeSpot(
  p: Project,
  room: Room,
  catalogId: string,
): { position: { x: number; y: number }; rotation: number; elevation: number } | null {
  const entry = getEntry(catalogId)!;
  const box = roomBox(room);
  const size = itemSize(entry, { x: 1, y: 1, z: 1 });
  const c = { x: (box.min.x + box.max.x) / 2, y: (box.min.y + box.max.y) / 2 };
  const pts: { x: number; y: number }[] = [];
  const step = 0.35;
  for (let x = box.min.x + 0.2; x <= box.max.x - 0.2; x += step)
    for (let y = box.min.y + 0.2; y <= box.max.y - 0.2; y += step)
      if (pointInPolygon({ x, y }, room.polygon)) pts.push({ x, y });
  const edgeDist = (q: { x: number; y: number }) =>
    Math.min(q.x - box.min.x, box.max.x - q.x, q.y - box.min.y, box.max.y - q.y);
  const wantsWall = entry.wallSnap !== false && entry.placement !== 'ceiling';
  pts.sort((a, b) =>
    wantsWall
      ? edgeDist(a) - edgeDist(b)
      : Math.hypot(a.x - c.x, a.y - c.y) - Math.hypot(b.x - c.x, b.y - c.y),
  );
  let fallback: { position: { x: number; y: number }; rotation: number; elevation: number } | null =
    null;
  for (const pt of pts) {
    const r = placeItem(p, room.levelId, entry, pt);
    if (!r.ok || !pointInPolygon(r.position, room.polygon)) continue;
    // Keep it fully inside the room.
    const half = Math.max(size.w, size.d) / 2;
    if (
      r.position.x - half < box.min.x - 0.2 ||
      r.position.x + half > box.max.x + 0.2 ||
      r.position.y - half < box.min.y - 0.2 ||
      r.position.y + half > box.max.y + 0.2
    )
      continue;
    const spot = { position: r.position, rotation: r.rotation, elevation: r.elevation };
    if (!r.warnings.length) return spot;
    fallback ??= spot;
  }
  return fallback;
}

/** Removes a room by dissolving the walls it shares with a neighbour, so the neighbour grows into it. */
function mergeAway(p: Project, room: Room, into?: Room): void {
  const level = p.rooms.filter((r) => r.levelId === room.levelId && r.id !== room.id);
  const shared = (a: Room, b: Room) => {
    let total = 0;
    const walls = p.walls.filter((w) => w.levelId === room.levelId);
    for (const w of walls) {
      const mid = { x: (w.start.x + w.end.x) / 2, y: (w.start.y + w.end.y) / 2 };
      const sides = ops.roomOnSide(p, w, 'left');
      const other = ops.roomOnSide(p, w, 'right');
      if ((sides?.id === a.id && other?.id === b.id) || (sides?.id === b.id && other?.id === a.id))
        total += Math.hypot(w.end.x - w.start.x, w.end.y - w.start.y);
      void mid;
    }
    return total;
  };
  const target =
    into ?? level.map((r) => ({ r, len: shared(room, r) })).sort((a, b) => b.len - a.len)[0]?.r;
  if (!target || shared(room, target) < 0.1) {
    ops.deleteRoomWithWalls(p, room.id);
    return;
  }
  const keep = {
    name: target.name,
    type: target.type,
    floor: target.floorMaterial,
    ceiling: target.ceilingMaterial,
  };
  const centre = {
    x: roomBox(target).min.x + (roomBox(target).max.x - roomBox(target).min.x) / 2,
    y: roomBox(target).min.y + (roomBox(target).max.y - roomBox(target).min.y) / 2,
  };
  // Walls that have the removed room on one side and the target on the other: remove them (splitting longer walls first).
  const between = p.walls.filter((w) => {
    if (w.levelId !== room.levelId) return false;
    const l = ops.roomOnSide(p, w, 'left');
    const r = ops.roomOnSide(p, w, 'right');
    return (l?.id === room.id && r?.id === target.id) || (l?.id === target.id && r?.id === room.id);
  });
  if (!between.length) {
    ops.deleteRoomWithWalls(p, room.id);
    return;
  }
  ops.deleteWallsAndSync(
    p,
    between.map((w) => w.id),
  );
  const merged = p.rooms.find(
    (r) => r.levelId === room.levelId && pointInPolygon(centre, r.polygon),
  );
  if (merged) {
    merged.name = keep.name;
    merged.type = keep.type;
    merged.floorMaterial = keep.floor;
    merged.ceilingMaterial = keep.ceiling;
  }
}

/**
 * Applies a list of edit operations to a project draft. Run it inside ONE store `apply` so the whole command is a single
 * undo step; any EditError / ModelError aborts everything and leaves the project untouched.
 */
export function applyEditOps(p: Project, list: EditOperation[], ctx: EditContext): void {
  try {
    for (const op of list) applyOne(p, op, ctx);
  } catch (e) {
    if (e instanceof ModelError)
      throw new EditError(t('ai.edit.wouldBreak').replace('{why}', e.message));
    throw e;
  }
  void fmt;
  void axisOf;
}
