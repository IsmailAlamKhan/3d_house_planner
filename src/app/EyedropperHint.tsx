import { useT } from '../i18n';
import { usePaint } from '../materials/paintStore';
import { Swatch } from './MaterialPicker';
import { materialName } from '../materials/eyedropper';

/** Explains the eyedropper and shows which material is currently on it. */
export function EyedropperHint() {
  const t = useT();
  const held = usePaint((s) => s.held);
  return (
    <div className="pointer-events-auto flex max-w-xs items-center gap-2 rounded-lg border border-slate-200 bg-white/95 p-2 text-xs text-slate-600 shadow-sm">
      {held && <Swatch id={held} size={24} selected />}
      <span>{held ? materialName(held) : null}</span>
      <span className="text-slate-500">{t('mat.eyedropperHint')}</span>
    </div>
  );
}
