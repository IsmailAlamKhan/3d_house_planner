import { useMemo } from 'react';
import { getEntry } from '../catalog';
import { labelPoint, polygonBounds } from '../geometry/polygon';
import { interiorLightsOn } from '../scene3d/lighting';
import { QUALITY, type Quality } from '../scene3d/quality';
import { useSceneProject } from '../scene3d/sceneProject';
import { useSceneStore } from '../scene3d/sceneStore';
import type { Project } from '../model/types';
import { usePresent } from './presentStore';

export interface Accent {
  id: string;
  position: [number, number, number];
  color: string;
  intensity: number;
  distance: number;
}

/** The accent lights of a project (a glow in lamp-less rooms, lights under wall cabinets, small garden path lights), unlimited. */
export function accentSpecs(project: Project): Accent[] {
  const out: Accent[] = [];
  for (const r of project.rooms) {
    const level = project.levels.find((l) => l.id === r.levelId);
    if (!level || !level.visible || r.type === 'corridor' || r.name === 'Open to below') continue;
    const hasLamp = project.items.some((i) => {
      if (i.levelId !== r.levelId || !getEntry(i.catalogId)?.lamp) return false;
      const b = polygonBounds(r.polygon);
      return (
        i.position.x >= b.min.x &&
        i.position.x <= b.max.x &&
        i.position.y >= b.min.y &&
        i.position.y <= b.max.y
      );
    });
    if (hasLamp) continue;
    const p = labelPoint(r.polygon);
    out.push({
      id: `room:${r.id}`,
      position: [p.x, level.elevation + level.floorToCeiling - 0.4, p.y],
      color: '#ffd7a0',
      intensity: 9,
      distance: 7,
    });
  }
  for (const i of project.items) {
    if (i.catalogId !== 'wall-cabinet') continue;
    const level = project.levels.find((l) => l.id === i.levelId);
    if (!level) continue;
    out.push({
      id: `cabinet:${i.id}`,
      position: [i.position.x, level.elevation + i.elevation - 0.08, i.position.y],
      color: '#fff0cf',
      intensity: 4,
      distance: 2.5,
    });
  }
  for (const z of project.site.zones) {
    if (z.type !== 'path') continue;
    const b = polygonBounds(z.polygon);
    const w = b.max.x - b.min.x;
    const d = b.max.y - b.min.y;
    const n = Math.max(1, Math.floor(Math.max(w, d) / 3.5));
    for (let k = 0; k < n; k++) {
      const t = (k + 0.5) / n;
      out.push({
        id: `path:${z.id}:${k}`,
        position:
          w >= d
            ? [b.min.x + w * t, 0.5, (b.min.y + b.max.y) / 2]
            : [(b.min.x + b.max.x) / 2, 0.5, b.min.y + d * t],
        color: '#ffcf8a',
        intensity: 5,
        distance: 5,
      });
    }
  }
  return out;
}

/**
 * Extra warm "accent" lights for presentation renders: a soft ceiling glow in rooms without a lamp, lights under wall
 * cabinets and small lights along garden paths. Part of the light budget of the quality level.
 */
export function AccentLights({ quality }: { quality: Quality }) {
  const project = useSceneProject();
  const lighting = useSceneStore((s) => s.lighting);
  const { active, accent } = usePresent();
  const on = active && accent && interiorLightsOn(lighting);
  const budget = Math.max(4, Math.floor(QUALITY[quality].maxLights / 2));

  const lights = useMemo<Accent[]>(() => {
    if (!on) return [];
    return accentSpecs(project).slice(0, budget);
  }, [on, project, budget]);

  return (
    <>
      {lights.map((l) => (
        <pointLight
          key={l.id}
          position={l.position}
          color={l.color}
          intensity={l.intensity}
          distance={l.distance}
          decay={2}
        />
      ))}
    </>
  );
}
