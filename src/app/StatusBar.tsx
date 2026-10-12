import { useT } from '../i18n';
import { useModel } from '../model/store';
import { GRID_SIZES, usePlanStore } from '../plan2d/planStore';
import { formatLength } from '../ui/units';

export function StatusBar() {
  const t = useT();
  const units = useModel((s) => s.project.units);
  const apply = useModel((s) => s.apply);
  const { snapEnabled, gridSize, cursor, setPref } = usePlanStore();
  return (
    <footer className="flex items-center gap-4 border-t border-slate-200 bg-white px-3 py-1 text-xs text-slate-600">
      <button
        className="rounded px-1 hover:bg-slate-100"
        title={t('status.unitsToggle')}
        onClick={() => apply((p) => void (p.units = p.units === 'metric' ? 'imperial' : 'metric'))}
      >
        {t('status.units')}: {units === 'metric' ? 'm' : 'ft/in'}
      </button>
      <button
        className="rounded px-1 hover:bg-slate-100"
        aria-pressed={snapEnabled}
        onClick={() => setPref('snapEnabled', !snapEnabled)}
      >
        {t('status.snap')}: {snapEnabled ? t('status.on') : t('status.off')}
      </button>
      <label className="flex items-center gap-1">
        {t('status.grid')}
        <select
          value={gridSize}
          onChange={(e) => setPref('gridSize', Number(e.target.value))}
          className="rounded border border-slate-200 bg-white px-1 py-0.5"
        >
          {GRID_SIZES.map((g) => (
            <option key={g} value={g}>
              {formatLength(g, units, 2)}
            </option>
          ))}
        </select>
      </label>
      <span className="ml-auto tabular-nums">
        {t('status.cursor')}:{' '}
        {cursor ? `${formatLength(cursor.x, units)}, ${formatLength(cursor.y, units)}` : '—'}
      </span>
    </footer>
  );
}
