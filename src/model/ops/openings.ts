import { findOverlappingOpening, openingFitsWall, wallHeight, wallLength } from '../integrity';
import type { Opening, OpeningKind, Project } from '../types';
import { ModelError, getOpening, getWall, newId } from './common';

export type NewOpening = Pick<Opening, 'wallId' | 'offset'> & Partial<Omit<Opening, 'id'>>;

const DEFAULTS: Record<
  OpeningKind,
  Pick<Opening, 'width' | 'height' | 'sillHeight' | 'swing' | 'catalogId'>
> = {
  door: { width: 0.9, height: 2.1, sillHeight: 0, swing: 'left', catalogId: 'door-single' },
  window: { width: 1.2, height: 1.2, sillHeight: 0.9, swing: 'none', catalogId: 'window-casement' },
  archway: { width: 1.2, height: 2.1, sillHeight: 0, swing: 'none', catalogId: 'archway' },
};

function validate(p: Project, o: Opening): void {
  const wall = getWall(p, o.wallId);
  if (!openingFitsWall(wallLength(wall), o.offset, o.width)) {
    throw new ModelError('That door/window does not fit on this wall', 'err.openingFit');
  }
  if (o.sillHeight + o.height > wallHeight(p, wall) + 1e-9) {
    throw new ModelError('That door/window is taller than the wall', 'err.openingTall');
  }
  if (findOverlappingOpening(p.openings, o.wallId, o)) {
    throw new ModelError('That spot is already taken by another door/window', 'err.openingTaken');
  }
}

export function addOpening(p: Project, input: NewOpening): string {
  const kind = input.kind ?? 'door';
  const d = DEFAULTS[kind];
  const opening: Opening = {
    id: newId(),
    wallId: input.wallId,
    kind,
    catalogId: input.catalogId ?? d.catalogId,
    offset: input.offset,
    width: input.width ?? d.width,
    height: input.height ?? d.height,
    sillHeight: input.sillHeight ?? d.sillHeight,
    flip: input.flip ?? false,
    swing: input.swing ?? d.swing,
    props: { ...(input.props ?? {}) },
    locked: input.locked ?? false,
  };
  validate(p, opening);
  p.openings.push(opening);
  return opening.id;
}

const GEOMETRY: (keyof Opening)[] = [
  'wallId',
  'offset',
  'width',
  'height',
  'sillHeight',
  'kind',
  'flip',
  'swing',
];

export function updateOpening(p: Project, id: string, patch: Partial<Omit<Opening, 'id'>>): void {
  const existing = getOpening(p, id);
  // Windows that already exist in the building's facade keep their place and size (style and frame colour may change).
  if (
    existing.locked &&
    GEOMETRY.some((k) => k in patch && (patch as Record<string, unknown>)[k] !== existing[k])
  ) {
    throw new ModelError(
      'That window is part of the existing building and is fixed.',
      'err.windowFixed',
    );
  }
  validate(p, { ...existing, ...patch });
  Object.assign(existing, patch);
}

export function deleteOpening(p: Project, id: string): void {
  if (getOpening(p, id).locked)
    throw new ModelError(
      'That window is part of the existing building and cannot be removed.',
      'err.windowKeep',
    );
  p.openings = p.openings.filter((o) => o.id !== id);
}
