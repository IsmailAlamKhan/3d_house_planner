import { toast } from '../catalog/actions';
import { t, tf, type TranslationKey } from '../i18n';
import { ModelError } from '../model/ops';
import { edit, useModel } from '../model/store';
import { isCustomPaint, resolveDef } from './library';
import { usePaint } from './paintStore';
import { type Surface, paintSurface, readSurface } from './surfaces';

/** Human name of a material id (custom paints show their colour). */
export function materialName(id: string): string {
  const def = resolveDef(id);
  return isCustomPaint(id)
    ? `${t('mat.paint-custom')} ${def.color}`
    : t(def.nameKey as TranslationKey);
}

/**
 * One click of the eyedropper: copies the surface's material when nothing is held (or with Alt),
 * otherwise paints the held material onto the surface.
 */
export function eyedrop(surface: Surface, alt: boolean): void {
  const { project, activeLevelId } = useModel.getState();
  const held = usePaint.getState().held;
  const current = readSurface(project, surface);
  if (alt || !held) {
    if (!current) return toast(t('mat.noSurface'));
    usePaint.getState().setHeld(current);
    return toast(tf('mat.copied', { name: materialName(current) }), 2500);
  }
  if (project.levels.find((l) => l.id === activeLevelId)?.locked) {
    return toast(
      tf('msg.levelLocked', { level: project.levels.find((l) => l.id === activeLevelId)!.name }),
    );
  }
  try {
    edit((p) => paintSurface(p, surface, held));
    toast(tf('mat.painted', { name: materialName(held) }), 1800);
  } catch (e) {
    toast(e instanceof ModelError ? e.message : t('mat.noSurface'));
  }
}
