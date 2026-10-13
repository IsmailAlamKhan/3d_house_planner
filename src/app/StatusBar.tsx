import { tf, useT } from '../i18n';
import { useSync } from '../persistence/syncStore';
import { useModel } from '../model/store';
import { GRID_SIZES, usePlanStore } from '../plan2d/planStore';
import { formatLength } from '../ui/units';
import { planToPicture } from '../underlay/matrix';

export function StatusBar() {
  const t = useT();
  const sync = useSync((s) => s.status);
  const units = useModel((s) => s.project.units);
  const apply = useModel((s) => s.apply);
  const { snapEnabled, gridSize, cursor, setPref } = usePlanStore();
  const underlay = useModel((s) => [...s.project.underlays].reverse().find((u) => u.visible));
  const onPicture = cursor && underlay ? planToPicture(underlay, cursor) : null;
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
      {sync !== 'local' && (
        <span
          data-testid="sync-status"
          data-status={sync}
          role="status"
          className={sync === 'offline' ? 'text-amber-700' : ''}
        >
          {t(`sync.${sync}` as 'sync.synced')}
        </span>
      )}
      {onPicture && (
        <span data-testid="underlay-readout" className="tabular-nums">
          {tf('underlay.readout', { x: Math.round(onPicture.x), y: Math.round(onPicture.y) })}
        </span>
      )}
      <span className="ml-auto tabular-nums">
        {t('status.cursor')}:{' '}
        {cursor ? `${formatLength(cursor.x, units)}, ${formatLength(cursor.y, units)}` : '—'}
      </span>
    </footer>
  );
}
