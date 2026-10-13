import { CylinderGeometry, BoxGeometry } from 'three';
import type { Vec2 } from '../../geometry/vec';
import type { Beam, Column, Level, Room } from '../../model/types';
import {
  type Part,
  extrudeMulti,
  flatMulti,
  mergeAll,
  subtractPolygons,
  unionPolygons,
} from './common';

/** Slab under a level: the shell footprint with `voids` cut out, `slabThickness` thick, top at y = 0. */
export function generateSlab(level: Level, footprint: Vec2[], voids: Vec2[][]): Part | null {
  if (level.slabThickness <= 0) return null;
  const geo = extrudeMulti(
    subtractPolygons(footprint, voids),
    level.slabThickness,
    -level.slabThickness,
  );
  return geo ? { id: `slab:${level.id}`, layer: 'slab', geometry: geo, materials: ['slab'] } : null;
}

/** A room's floor surface (just above the slab top), minus any slab openings. */
export function generateRoomFloor(room: Room, voids: Vec2[][]): Part | null {
  const geo = flatMulti(subtractPolygons(room.polygon, voids), 0.002, true);
  return geo
    ? {
        id: `floor:${room.id}`,
        layer: 'floor',
        entity: { type: 'room', id: room.id },
        geometry: geo,
        materials: [room.floorMaterial],
      }
    : null;
}

/**
 * A room's ceiling. Double-height rooms have none. `voidsAbove` are openings in the slab overhead
 * (stairs, voids) which must also be open in the ceiling.
 */
export function generateRoomCeiling(room: Room, level: Level, voidsAbove: Vec2[][]): Part | null {
  if (room.doubleHeight || room.type === 'outdoor') return null;
  const y = room.ceilingHeight ?? level.floorToCeiling;
  const geo = flatMulti(subtractPolygons(room.polygon, voidsAbove), y - 0.002, false);
  return geo
    ? {
        id: `ceiling:${room.id}`,
        layer: 'ceiling',
        entity: { type: 'room', id: room.id },
        geometry: geo,
        materials: [room.ceilingMaterial],
      }
    : null;
}

/** Flat roof slab on top of a level, with skylight openings (glass added separately). */
export function generateFlatRoof(
  id: string,
  level: Level,
  polygon: Vec2[],
  skylights: Vec2[][],
  voids: Vec2[][],
): Part[] {
  const parts: Part[] = [];
  const geo = extrudeMulti(
    subtractPolygons(polygon, [...skylights, ...voids]),
    level.slabThickness || 0.15,
    level.floorToCeiling,
  );
  if (geo)
    parts.push({
      id: `roof:${id}`,
      layer: 'roof',
      entity: { type: 'roof', id },
      geometry: geo,
      materials: ['roof'],
    });
  const glass = mergeAll(
    unionPolygons(skylights).map((poly) => {
      const g = extrudeMulti(
        [poly],
        0.02,
        level.floorToCeiling + (level.slabThickness || 0.15) / 2,
      );
      return g!;
    }),
  );
  if (glass)
    parts.push({
      id: `skylight:${id}`,
      layer: 'roof',
      entity: { type: 'roof', id },
      geometry: glass,
      materials: ['glass'],
    });
  return parts;
}

export function generateColumn(column: Column, level: Level): Part {
  const h = level.floorToCeiling;
  const geo =
    column.shape === 'round'
      ? new CylinderGeometry(column.size.w / 2, column.size.w / 2, h, 24).scale(
          1,
          1,
          column.size.d / column.size.w,
        )
      : new BoxGeometry(column.size.w, h, column.size.d);
  geo.translate(column.position.x, h / 2, column.position.y);
  return {
    id: `column:${column.id}`,
    layer: 'column',
    entity: { type: 'column', id: column.id },
    geometry: geo,
    materials: ['column'],
  };
}

/** A structural beam hanging `drop` m below the ceiling of its level (same concrete as the columns). */
export function generateBeam(beam: Beam, level: Level): Part {
  const h = level.floorToCeiling;
  const len = Math.hypot(beam.end.x - beam.start.x, beam.end.y - beam.start.y) || 0.01;
  const geo = new BoxGeometry(len, beam.drop, beam.width);
  geo.rotateY(-Math.atan2(beam.end.y - beam.start.y, beam.end.x - beam.start.x));
  geo.translate(
    (beam.start.x + beam.end.x) / 2,
    h - beam.drop / 2,
    (beam.start.y + beam.end.y) / 2,
  );
  return { id: `beam:${beam.id}`, layer: 'column', geometry: geo, materials: ['column'] };
}
