import { type Vec2, dist } from '../geometry/vec';
import { addNote, notePin } from '../model/ops';
import { useModel } from '../model/store';
import type { Note } from '../model/types';
import { usePlanStore } from '../plan2d/planStore';
import { useCamera } from '../scene3d/camera/cameraStore';
import { poseForFocus } from '../scene3d/camera/focus';
import type { Vec3 } from '../scene3d/camera/views';
import { useUiStore } from '../ui/uiStore';

/** Pins within this many screen pixels of a click are "hit". */
export const PIN_RADIUS_PX = 14;

/** Creates a note at a plan point (optionally attached to an entity), opens the notes panel on it. */
export function createNote(
  position: Vec2,
  entity?: Note['entity'],
  levelId = useModel.getState().activeLevelId,
): string {
  const id = useModel.getState().apply((p) => addNote(p, { levelId, position, entity }));
  const ui = useUiStore.getState();
  ui.setActiveNoteId(id);
  ui.setLeftTab('notes');
  ui.setLeftDrawerOpen(window.innerWidth < 1024);
  return id;
}

/** A note about whatever is selected right now. */
export function createNoteForSelection(): string | null {
  const { project, selection } = useModel.getState();
  const id = selection.ids[0];
  if (!selection.type || !id) return null;
  const probe: Note = {
    id: 'probe',
    text: '',
    resolved: false,
    createdAt: '',
    levelId: useModel.getState().activeLevelId,
    position: { x: 0, y: 0 },
    entity: { type: selection.type, id },
  };
  const pin = notePin(project, probe);
  return createNote(pin.position, probe.entity, pin.levelId);
}

/** The pin (if any) under a plan point on the active level. */
export function pinAt(w: Vec2): string | null {
  const { project, activeLevelId } = useModel.getState();
  const px = 1 / usePlanStore.getState().view.scale;
  let best: { id: string; d: number } | null = null;
  for (const n of project.notes) {
    const pin = notePin(project, n);
    if (pin.levelId !== activeLevelId) continue;
    const d = dist(pin.position, w);
    if (d <= PIN_RADIUS_PX * px && (!best || d < best.d)) best = { id: n.id, d };
  }
  return best?.id ?? null;
}

/** Brings a note into view: its level, the plan around it, and the 3D camera. */
export function showNote(id: string): void {
  const { project } = useModel.getState();
  const note = project.notes.find((n) => n.id === id);
  if (!note) return;
  const pin = notePin(project, note);
  const model = useModel.getState();
  model.setActiveLevel(pin.levelId);
  useUiStore.getState().setActiveNoteId(id);
  const ps = usePlanStore.getState();
  if (ps.size.w)
    ps.setView({
      ...ps.view,
      tx: ps.size.w / 2 - pin.position.x * ps.view.scale,
      ty: ps.size.h / 2 - pin.position.y * ps.view.scale,
    });
  if (model.viewMode !== '2d') {
    const level = project.levels.find((l) => l.id === pin.levelId);
    const cam = useCamera.getState();
    if (cam.mode === 'orbit' || cam.mode === 'top') {
      const center: Vec3 = [pin.position.x, (level?.elevation ?? 0) + 1.2, pin.position.y];
      cam.flyTo(poseForFocus({ center, radius: 1.8 }, cam.live.position));
    }
  }
}
