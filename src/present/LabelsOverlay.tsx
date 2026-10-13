import { useEffect, useRef } from 'react';
import { useModel } from '../model/store';
import { isolatedLevelId } from '../scene3d/camera/isolation';
import { useCamera } from '../scene3d/camera/cameraStore';
import { useSceneProject } from '../scene3d/sceneProject';
import { getLabelFrame } from './labelFrame';
import { drawLabels, projectLabels, roomLabels } from './labels';
import { usePresent } from './presentStore';

/** Which levels a picture shows (for labels): the isolated level, else every visible level. */
export function visibleLevelIds(
  project: { levels: { id: string; visible: boolean }[] },
  isolation = useCamera.getState().isolation,
): Set<string> {
  const iso = isolatedLevelId(isolation);
  return new Set(project.levels.filter((l) => (iso ? l.id === iso : l.visible)).map((l) => l.id));
}

/** Room names and sizes drawn over the 3D view while presentation mode is on (vector text, never part of the 3D scene). */
export function LabelsOverlay() {
  const ref = useRef<HTMLCanvasElement>(null);
  const project = useSceneProject();
  const { active, labels, hiddenLabels } = usePresent();
  const isolation = useCamera((s) => s.isolation);
  const activeLevel = useModel((s) => s.activeLevelId);
  const show = active && labels.show;

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas || !show) return;
    const items = roomLabels(project, {
      mode: labels.mode,
      hidden: new Set(hiddenLabels),
      levelIds: visibleLevelIds(project, isolation),
    });
    let raf = 0;
    let last = '';
    const draw = () => {
      raf = requestAnimationFrame(draw);
      const f = getLabelFrame();
      if (!f) return;
      const key = f.viewProjection.join(',') + `|${f.width}x${f.height}`;
      if (key === last) return;
      last = key;
      const dpr = window.devicePixelRatio || 1;
      canvas.width = Math.round(f.width * dpr);
      canvas.height = Math.round(f.height * dpr);
      const ctx = canvas.getContext('2d');
      if (!ctx) return;
      ctx.scale(dpr, dpr);
      drawLabels(
        ctx,
        projectLabels(items, f.viewProjection, f.width, f.height),
        labels,
        f.width,
        f.height,
      );
    };
    draw();
    return () => cancelAnimationFrame(raf);
  }, [show, project, labels, hiddenLabels, isolation, activeLevel]);

  if (!show) return null;
  return (
    <canvas
      ref={ref}
      data-testid="present-labels"
      aria-hidden
      className="pointer-events-none absolute inset-0 h-full w-full"
    />
  );
}
