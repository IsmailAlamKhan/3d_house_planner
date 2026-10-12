import { useThree } from '@react-three/fiber';
import { useEffect } from 'react';
import { Raycaster, Vector2 } from 'three';
import { freePoint, placeCatalogEntry, updateCatalogHover } from '../catalog/actions';
import { carriedId, useCatalogDrag } from '../catalog/dragStore';
import { getEntry } from '../catalog';
import { useModel } from '../model/store';
import { pickPlanPoint } from './pick';

const MIME = 'application/x-duplex-catalog';
const CLICK_SLOP_PX = 5;

/**
 * Lets library items be dropped (mouse drag) or placed (tap/click after picking) in the 3D view.
 * Drops raycast to the floor of the active level; doors and windows to the wall surface under the pointer.
 */
export function DropTarget() {
  const get = useThree((s) => s.get);

  useEffect(() => {
    const el = get().gl.domElement;
    const ray = new Raycaster();

    const pick = (e: { clientX: number; clientY: number }, id: string) => {
      const entry = getEntry(id);
      if (!entry) return null;
      const r = el.getBoundingClientRect();
      const ndc = new Vector2(
        ((e.clientX - r.left) / r.width) * 2 - 1,
        -((e.clientY - r.top) / r.height) * 2 + 1,
      );
      const { camera, scene } = get();
      ray.setFromCamera(ndc, camera);
      const { project, activeLevelId } = useModel.getState();
      const elevation = project.levels.find((l) => l.id === activeLevelId)?.elevation ?? 0;
      const point = pickPlanPoint(entry, ray, scene, elevation);
      return point ? { entry, point } : null;
    };

    const onDragOver = (e: DragEvent) => {
      const id = useCatalogDrag.getState().dragId;
      if (!id && !e.dataTransfer?.types.includes(MIME)) return;
      e.preventDefault();
      if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy';
      const hit = id ? pick(e, id) : null;
      if (hit) updateCatalogHover(hit.point, e.altKey);
    };
    const onDragLeave = () => useCatalogDrag.getState().setHover(null);
    const onDrop = (e: DragEvent) => {
      const id = e.dataTransfer?.getData(MIME) || useCatalogDrag.getState().dragId;
      useCatalogDrag.getState().setDrag(null);
      useCatalogDrag.getState().setHover(null);
      if (!id) return;
      e.preventDefault();
      const hit = pick(e, id);
      if (hit)
        placeCatalogEntry(id, hit.entry.placement === 'wall' ? hit.point : freePoint(hit.point), {
          snapWalls: !e.altKey,
        });
    };

    // Tap/click placement for an armed library item (also the touch-screen alternative to dragging).
    let down: { x: number; y: number } | null = null;
    const onPointerDown = (e: PointerEvent) => {
      down = { x: e.clientX, y: e.clientY };
    };
    const onPointerMove = (e: PointerEvent) => {
      const id = carriedId(useCatalogDrag.getState());
      if (!id || e.buttons) return;
      const hit = pick(e, id);
      if (hit) updateCatalogHover(hit.point, e.altKey);
    };
    const onClick = (e: MouseEvent) => {
      const id = useCatalogDrag.getState().armedId;
      if (!id || !down || Math.hypot(e.clientX - down.x, e.clientY - down.y) > CLICK_SLOP_PX)
        return;
      const hit = pick(e, id);
      if (!hit) return;
      placeCatalogEntry(id, hit.entry.placement === 'wall' ? hit.point : freePoint(hit.point), {
        snapWalls: !e.altKey,
      });
      useCatalogDrag.getState().setArmed(null);
    };

    el.addEventListener('dragover', onDragOver);
    el.addEventListener('dragleave', onDragLeave);
    el.addEventListener('drop', onDrop);
    el.addEventListener('pointerdown', onPointerDown);
    el.addEventListener('pointermove', onPointerMove);
    el.addEventListener('click', onClick);
    return () => {
      el.removeEventListener('dragover', onDragOver);
      el.removeEventListener('dragleave', onDragLeave);
      el.removeEventListener('drop', onDrop);
      el.removeEventListener('pointerdown', onPointerDown);
      el.removeEventListener('pointermove', onPointerMove);
      el.removeEventListener('click', onClick);
    };
  }, [get]);

  return null;
}
