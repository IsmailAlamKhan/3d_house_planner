import { type Matrix3, invertMatrix3 } from '../../geometry/homography';
import type { Project, Underlay } from '../types';
import { ModelError, newId } from './common';

export type NewUnderlay = Omit<
  Underlay,
  'id' | 'transform' | 'offset' | 'rotation' | 'opacity' | 'visible' | 'locked' | 'onTop' | 'show3d'
> & { transform: Matrix3 } & Partial<
    Pick<Underlay, 'offset' | 'rotation' | 'opacity' | 'visible' | 'locked' | 'onTop' | 'show3d'>
  >;

const clamp01 = (v: number) => Math.min(1, Math.max(0, v));

const checkMatrix = (m: Matrix3) => {
  if (!m.every(Number.isFinite) || !invertMatrix3(m))
    throw new ModelError(
      'That picture setup cannot be used (the corners are in a line)',
      'err.underlayMatrix',
    );
};

const getUnderlay = (p: Project, id: string): Underlay => {
  const u = p.underlays.find((x) => x.id === id);
  if (!u) throw new ModelError(`Reference picture not found: ${id}`);
  return u;
};

/** Adds a reference picture (it goes on top of the earlier ones). Returns its id. */
export function addUnderlay(p: Project, input: NewUnderlay): string {
  checkMatrix(input.transform);
  const id = newId();
  p.underlays.push({
    id,
    name: input.name,
    levelId: input.levelId,
    source: input.source,
    imageWidth: input.imageWidth,
    imageHeight: input.imageHeight,
    transform: [...input.transform] as Underlay['transform'],
    setup: input.setup,
    offset: input.offset ?? { x: 0, y: 0 },
    rotation: input.rotation ?? 0,
    opacity: clamp01(input.opacity ?? 0.5),
    visible: input.visible ?? true,
    locked: input.locked ?? false,
    onTop: input.onTop ?? false,
    show3d: input.show3d ?? false,
  });
  return id;
}

/** Changes a reference picture. A locked picture can only be unlocked. */
export function updateUnderlay(
  p: Project,
  id: string,
  patch: Partial<Omit<Underlay, 'id' | 'transform'>> & { transform?: Matrix3 },
): void {
  const u = getUnderlay(p, id);
  if (u.locked) {
    const keys = Object.keys(patch);
    if (
      keys.some(
        (k) =>
          k !== 'locked' && k !== 'visible' && k !== 'opacity' && k !== 'onTop' && k !== 'show3d',
      )
    )
      throw new ModelError('Unlock the reference picture to move it', 'err.underlayLocked');
  }
  if (patch.transform) checkMatrix(patch.transform);
  const { transform, ...rest } = patch;
  Object.assign(u, rest, patch.opacity !== undefined ? { opacity: clamp01(patch.opacity) } : {});
  if (transform) u.transform = [...transform] as Underlay['transform'];
}

export function deleteUnderlay(p: Project, id: string): void {
  getUnderlay(p, id);
  p.underlays = p.underlays.filter((x) => x.id !== id);
}

/** Puts a picture behind all the other pictures (the list is back-most first). */
export function sendUnderlayToBack(p: Project, id: string): void {
  const u = getUnderlay(p, id);
  p.underlays = [u, ...p.underlays.filter((x) => x.id !== id)];
}

export function bringUnderlayToFront(p: Project, id: string): void {
  const u = getUnderlay(p, id);
  p.underlays = [...p.underlays.filter((x) => x.id !== id), u];
}
