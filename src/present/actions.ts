import { t } from '../i18n';
import { useModel } from '../model/store';
import { useCamera } from '../scene3d/camera/cameraStore';
import { NO_ISOLATION } from '../scene3d/camera/isolation';
import { presetPose } from '../scene3d/camera/views';
import { useSceneStore } from '../scene3d/sceneStore';
import { cutawayPose, lightingFor, type PresentLook, type PresentPreset } from './presets';
import { usePresent } from './presentStore';

const aspectOfView = (): number => {
  const el = document.querySelector('[data-testid="scene-canvas"]');
  return el ? el.clientWidth / Math.max(el.clientHeight, 1) : 1.6;
};

/** What presentation mode changes in the scene, so leaving it puts everything back. */
function snapshot() {
  const s = useSceneStore.getState();
  return {
    dollhouse: s.dollhouse,
    wallMode: s.wallMode,
    levelFilter: s.levelFilter,
    lighting: s.lighting,
    isolation: useCamera.getState().isolation,
  };
}

export function applyLook(look: PresentLook): void {
  usePresent.getState().patch({ look });
  useSceneStore.getState().setPref('lighting', lightingFor(look));
}

/**
 * Switches presentation mode on with a preset: cutaway views hide ceilings and roofs, cap the walls and isolate the
 * active level; the eye-level preset uses the first saved view (or the isometric view). The camera frames the level.
 * Returns false when there is nothing to show.
 */
export function enterPresent(preset: PresentPreset): boolean {
  const model = useModel.getState();
  const project = model.project;
  const present = usePresent.getState();
  if (!project.levels.length) return false;
  const scene = useSceneStore.getState();
  const cam = useCamera.getState();
  present.setActive(
    true,
    preset,
    present.active ? undefined : (snapshot() as Record<string, unknown>),
  );
  if (model.viewMode === '2d') model.setViewMode('3d');
  if (cam.mode !== 'orbit') cam.setMode('orbit');
  scene.setPref('lighting', lightingFor(present.look));
  if (preset === 'eye') {
    scene.setPref('dollhouse', false);
    scene.setPref('wallMode', 'up');
    scene.setPref('levelFilter', 'all');
    cam.setIsolation(NO_ISOLATION);
    const view = project.views[0];
    cam.flyTo(
      view
        ? { position: view.position, target: view.target }
        : presetPose(project, 'iso', aspectOfView()),
    );
    return true;
  }
  scene.setPref('dollhouse', true);
  scene.setPref('wallMode', 'cut');
  scene.setPref('levelFilter', 'all');
  const levelId = project.levels.some((l) => l.id === model.activeLevelId)
    ? model.activeLevelId
    : project.levels[0]!.id;
  cam.setIsolation({ kind: 'level', levelId });
  cam.flyTo(cutawayPose(project, preset, levelId, aspectOfView()));
  return true;
}

/** Re-frames the camera on the active level (after the user changed level while presenting). */
export function reframe(): void {
  const { preset } = usePresent.getState();
  if (!preset || preset === 'eye') return;
  const model = useModel.getState();
  const levelId = model.activeLevelId;
  useCamera.getState().setIsolation({ kind: 'level', levelId });
  useCamera.getState().flyTo(cutawayPose(model.project, preset, levelId, aspectOfView()));
}

export function exitPresent(): void {
  const p = usePresent.getState();
  const r = p.restore as ReturnType<typeof snapshot> | null;
  if (r) {
    const s = useSceneStore.getState();
    s.setPref('dollhouse', r.dollhouse);
    s.setPref('wallMode', r.wallMode);
    s.setPref('levelFilter', r.levelFilter);
    s.setPref('lighting', r.lighting);
    useCamera.getState().setIsolation(r.isolation);
  }
  p.setActive(false);
}

export const presetLabel = (preset: PresentPreset): string =>
  t(`present.preset.${preset}` as 'present.preset.cutaway-top');
