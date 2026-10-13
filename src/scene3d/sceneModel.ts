import { computeWallPolygons } from '../geometry/walls';
import type { Level, Opening, Project } from '../model/types';
import { PartCache } from './cache';
import {
  generateBeam,
  generateColumn,
  generateFlatRoof,
  generateRoomCeiling,
  generateRoomFloor,
  generateSlab,
} from './generators/floors';
import type { AnyPart } from './generators/common';
import { generateItemPart } from './generators/items';
import { generateOpeningParts } from './generators/openings';
import { generateStair } from './generators/stairs';
import { doubleHeightVoids, levelAbove, slabVoids } from './generators/voids';
import { generateVoidBalustrade } from './generators/balustrade';
import { generateWall } from './generators/walls';
import { generateSite } from './generators/site';

export type WallMode = 'up' | 'cut' | 'transparent';

export interface BuildOptions {
  wallMode: WallMode;
  /** Wall height in "cut" mode (m). */
  cutHeight: number;
  doorsOpen: boolean;
}

export const DEFAULT_CUT_HEIGHT = 1.2;

export interface LevelScene {
  level: Level;
  parts: AnyPart[];
}

/** Turns the project into renderable parts, level by level, reusing cached geometry for unchanged entities. */
export class SceneBuilder {
  readonly cache = new PartCache();

  build(project: Project, opts: BuildOptions): LevelScene[] & { site: AnyPart[] } {
    const c = this.cache;
    c.begin();
    const footprint = project.shell.footprint;
    const levels = [...project.levels].sort((a, b) => a.index - b.index);
    const result: LevelScene[] = [];

    for (const level of levels) {
      const parts: AnyPart[] = [];
      const voids = slabVoids(project, level);
      const voidsKey = JSON.stringify(voids);
      const above = levelAbove(project, level);
      const voidsAbove = above ? slabVoids(project, above) : [];
      const voidsAboveKey = JSON.stringify(voidsAbove);

      parts.push(
        ...c.get(`slab:${level.id}`, [level.slabThickness, footprint, voidsKey], () => {
          const s = generateSlab(level, footprint, voids);
          return s ? [s] : [];
        }),
      );

      // Walls + their frames
      const walls = project.walls.filter((w) => w.levelId === level.id);
      const polys = computeWallPolygons(walls);
      const openingsByWall = new Map<string, Opening[]>();
      for (const o of project.openings) {
        const list = openingsByWall.get(o.wallId) ?? [];
        list.push(o);
        openingsByWall.set(o.wallId, list);
      }
      for (const wall of walls) {
        const polygon = polys.get(wall.id);
        if (!polygon) continue;
        const openings = openingsByWall.get(wall.id) ?? [];
        const full = wall.height ?? level.floorToCeiling;
        const height = opts.wallMode === 'cut' ? Math.min(full, opts.cutHeight) : full;
        const polyKey = polygon.map((p) => `${p.x.toFixed(5)},${p.y.toFixed(5)}`).join(';');
        parts.push(
          ...c.get(`wall:${wall.id}`, [wall, polyKey, height, footprint, ...openings], () => {
            const w = generateWall({ wall, polygon, openings, height, footprint });
            return w ? [w] : [];
          }),
        );
        for (const o of openings) {
          parts.push(
            ...c.get(`opening:${o.id}`, [o, wall, opts.doorsOpen, footprint], () =>
              generateOpeningParts({ opening: o, wall, doorsOpen: opts.doorsOpen, footprint }),
            ),
          );
        }
      }

      for (const room of project.rooms.filter((r) => r.levelId === level.id)) {
        parts.push(
          ...c.get(`floor:${room.id}`, [room, voidsKey], () => {
            const f = generateRoomFloor(room, voids);
            return f ? [f] : [];
          }),
        );
        parts.push(
          ...c.get(`ceiling:${room.id}`, [room, level.floorToCeiling, voidsAboveKey], () => {
            const f = generateRoomCeiling(room, level, voidsAbove);
            return f ? [f] : [];
          }),
        );
      }

      for (const col of project.columns.filter((k) => k.levelId === level.id)) {
        parts.push(
          ...c.get(`column:${col.id}`, [col, level.floorToCeiling], () => [
            generateColumn(col, level),
          ]),
        );
      }

      for (const beam of project.shell.beams) {
        parts.push(
          ...c.get(`beam:${level.id}:${beam.id}`, [beam, level.floorToCeiling], () => [
            generateBeam(beam, level),
          ]),
        );
      }

      for (const stair of project.stairs.filter((s) => s.fromLevelId === level.id)) {
        const to = project.levels.find((l) => l.id === stair.toLevelId);
        if (!to) continue;
        parts.push(
          ...c.get(`stair:${stair.id}`, [stair, level, to], () => generateStair(stair, level, to)),
        );
      }

      for (const item of project.items.filter((i) => i.levelId === level.id)) {
        parts.push(
          ...c.get(`item:${item.id}`, [item], () => {
            const p = generateItemPart(item);
            return p ? [p] : [];
          }),
        );
      }

      for (const dh of doubleHeightVoids(project, level)) {
        parts.push(
          ...c.get(
            `balustrade:${level.id}:${dh.roomId}`,
            [JSON.stringify(dh.polygon), ...walls],
            () =>
              generateVoidBalustrade(
                `balustrade:${level.id}:${dh.roomId}`,
                dh.polygon,
                walls,
                dh.roomId,
              ),
          ),
        );
      }

      const skylights = project.roofs.filter(
        (r) => r.levelId === level.id && r.kind === 'skylight',
      );
      const skyKey = JSON.stringify(skylights.map((s) => s.polygon));
      for (const roof of project.roofs.filter((r) => r.levelId === level.id && r.kind === 'flat')) {
        parts.push(
          ...c.get(
            `roof:${roof.id}`,
            [roof, level.floorToCeiling, level.slabThickness, skyKey],
            () =>
              generateFlatRoof(
                roof.id,
                level,
                roof.polygon,
                skylights.map((s) => s.polygon),
                [],
              ),
          ),
        );
      }
      result.push({ level, parts });
    }
    // The plot, its zones, fence and gates (villas): not part of any level.
    const site: AnyPart[] =
      project.kind === 'villa'
        ? c.get('site', [project.site, project.kind], () => generateSite(project))
        : [];
    c.sweep();
    return Object.assign(result, { site });
  }

  dispose(): void {
    this.cache.dispose();
  }
}
