import { useThree } from '@react-three/fiber';
import { useEffect } from 'react';
import { CubeCamera, HalfFloatType, PMREMGenerator, Vector3, WebGLCubeRenderTarget } from 'three';
import { polygonBounds } from '../geometry/polygon';
import { useModel } from '../model/store';
import type { Quality } from '../scene3d/quality';
import { useBake } from './bakeStore';
import { type Probe, setProbes } from './runtime';

/** Size of one face of a probe's cube map. */
const FACE = 128;

/**
 * Reflection probes for baked lighting: one box-projected cube map per level, rendered in the app from the middle of the
 * level once the bake is on screen, so floors and walls reflect the room (and not just the sky). The surfaces pick them up
 * through `bakedMaterial`; the first level's probe also serves the plot. Not on Low quality.
 */
export function ReflectionProbes({ quality }: { quality: Quality }) {
  const get = useThree((s) => s.get);
  const applied = useBake((s) => s.applied);
  useEffect(() => {
    if (!applied || quality === 'low') {
      setProbes(new Map());
      return;
    }
    let cancelled = false;
    // wait for the baked surfaces to be on screen: the probe photographs the scene as it looks
    const timer = setTimeout(() => {
      if (cancelled) return;
      const { gl, scene } = get();
      const project = useModel.getState().project;
      const b = polygonBounds(project.shell.footprint);
      const levels = [...project.levels].sort((a, c) => a.index - c.index);
      const pmrem = new PMREMGenerator(gl);
      const next = new Map<string, Probe>();
      levels.forEach((level, i) => {
        const min = new Vector3(b.min.x - 1, level.elevation, b.min.y - 1);
        const max = new Vector3(b.max.x + 1, level.elevation + level.floorToCeiling, b.max.y + 1);
        const position = new Vector3(
          (b.min.x + b.max.x) / 2,
          level.elevation + 1.4,
          (b.min.y + b.max.y) / 2,
        );
        const target = new WebGLCubeRenderTarget(FACE, { type: HalfFloatType });
        const cam = new CubeCamera(0.1, 120, target);
        cam.position.copy(position);
        scene.add(cam);
        cam.update(gl, scene);
        scene.remove(cam);
        const texture = pmrem.fromCubemap(target.texture).texture;
        target.dispose();
        const probe = { texture, position, min, max };
        next.set(level.id, probe);
        if (i === 0) next.set('ground', probe);
      });
      pmrem.dispose();
      setProbes(next);
    }, 2500);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [get, applied, quality]);
  return null;
}
