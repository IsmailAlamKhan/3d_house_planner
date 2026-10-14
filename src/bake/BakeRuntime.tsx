import { useEffect, useRef } from 'react';
import { useModel } from '../model/store';
import { useBake } from './bakeStore';
import { clearBakedMaterials } from './runtime';
import { useBakeStatus, useCurrentPreset, useRealistic } from './useBakeStatus';

/** Idle time after the last edit before an automatic rebake starts. */
export const AUTO_REBAKE_MS = 2 * 60 * 1000;

/**
 * Keeps the 3D view in step with the bakes of the open project: loads the list when a project opens, loads the bake that
 * suits the current look (or drops it when the look is not realistic, the switch is off or no bake exists) and, when asked,
 * rebakes a stale bake after two idle minutes. Renders nothing.
 */
export function BakeRuntime() {
  const projectId = useModel((s) => s.project.id);
  const preset = useCurrentPreset();
  const realistic = useRealistic();
  const enabled = useBake((s) => s.enabled);
  const bakes = useBake((s) => s.bakes);
  const applied = useBake((s) => s.applied);
  const auto = useBake((s) => s.auto);
  const busy = useBake((s) => s.busy);
  const { stale } = useBakeStatus();

  // the bakes of a project belong to it: list them when it opens
  useEffect(() => {
    useBake.setState({ bakes: {} });
    void useBake.getState().refresh();
  }, [projectId]);

  useEffect(() => {
    void useBake.getState().sync({ projectId, preset, realistic });
  }, [projectId, preset, realistic, enabled, bakes]);

  // patched materials belong to one bake
  useEffect(() => () => clearBakedMaterials(), [applied]);

  // auto-rebake: two minutes without an edit
  const project = useModel((s) => s.project);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => {
    clearTimeout(timer.current);
    if (!auto || !stale || busy) return;
    timer.current = setTimeout(() => void useBake.getState().start(preset), AUTO_REBAKE_MS);
    return () => clearTimeout(timer.current);
  }, [auto, stale, busy, preset, project]);

  return null;
}
