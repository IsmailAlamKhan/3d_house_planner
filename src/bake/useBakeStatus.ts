import { useEffect, useState } from 'react';
import { useModel } from '../model/store';
import { useCamera } from '../scene3d/camera/cameraStore';
import { effectiveLightStyle, useSceneStore } from '../scene3d/sceneStore';
import { usePresent } from '../present/presentStore';
import { bakeKey } from './bakeKey';
import { useBake } from './bakeStore';
import { type BakeMeta, type BakePreset, presetOfMode } from './protocol';

/** The lighting preset the 3D view is showing now (day, dusk or night). */
export function useCurrentPreset(): BakePreset {
  return useSceneStore((s) => presetOfMode(s.lighting.mode, s.lighting.time));
}

/** Is the realistic lighting style in force (baked lighting only replaces realistic lighting)? */
export function useRealistic(): boolean {
  const pref = useSceneStore((s) => s.lightStyle);
  const viewMode = useModel((s) => s.viewMode);
  const walking = useCamera((s) => s.mode === 'walk');
  const presenting = usePresent((s) => s.active);
  return effectiveLightStyle(pref, viewMode, walking, presenting) === 'realistic';
}

export interface BakeStatus {
  preset: BakePreset;
  meta: BakeMeta | undefined;
  /** A bake exists for this look but the design changed since (geometry or light switches). */
  stale: boolean;
}

/** The bake of the current look and whether it is out of date; re-checked 600 ms after the last edit. */
export function useBakeStatus(): BakeStatus {
  const preset = useCurrentPreset();
  const meta = useBake((s) => s.bakes[preset]);
  const project = useModel((s) => s.project);
  const [stale, setStale] = useState(false);
  useEffect(() => {
    if (!meta) return;
    const h = setTimeout(() => setStale(bakeKey(project, preset) !== meta.key), 600);
    return () => clearTimeout(h);
  }, [project, preset, meta]);
  return { preset, meta, stale: !!meta && stale };
}
