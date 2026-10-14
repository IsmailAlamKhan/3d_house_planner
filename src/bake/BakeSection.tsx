import { useEffect } from 'react';
import { useT } from '../i18n';
import { BAKE_QUALITIES, type BakeQuality } from './protocol';
import { useBake } from './bakeStore';
import { useBakeStatus } from './useBakeStatus';

const btn =
  'rounded-md bg-slate-800 px-2 py-1 text-xs text-white hover:bg-slate-700 disabled:opacity-50';
const ghost =
  'rounded-md border border-slate-300 px-2 py-0.5 text-xs hover:bg-slate-100 disabled:opacity-50';

/** "Baked lighting" in the light and quality popover: bake the current look with Blender, see whether it is out of date. */
export function BakeSection() {
  const t = useT();
  const s = useBake();
  const { preset, meta, stale } = useBakeStatus();
  useEffect(() => {
    void s.refreshHealth();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const ready = !!s.health?.ready;
  const status = (() => {
    if (s.phase === 'preparing') return t('bake.preparing');
    const j = s.job;
    if (!j) return s.phase === 'waiting' ? t('bake.sending') : '';
    if (j.status === 'queued')
      return j.ahead > 0 ? t('bake.queued').replace('{n}', String(j.ahead)) : t('bake.starting');
    if (j.status === 'running' && j.progress)
      return t('bake.sampling')
        .replace('{n}', String(j.progress.sample))
        .replace('{max}', String(j.progress.total));
    return t('bake.starting');
  })();
  const look = t(`bake.preset.${preset}` as 'bake.preset.day');
  return (
    <div className="space-y-1.5 border-t border-slate-200 pt-2" data-testid="bake-section">
      <p className="text-xs font-medium text-slate-600">{t('bake.title')}</p>
      <label className="flex items-center justify-between text-xs text-slate-600">
        {t('bake.use')}
        <input
          type="checkbox"
          data-testid="bake-use"
          checked={s.enabled}
          onChange={(e) => s.patch({ enabled: e.target.checked })}
        />
      </label>
      {stale && (
        <p
          role="status"
          data-testid="bake-stale"
          className="rounded bg-amber-100 px-2 py-1 text-xs font-medium text-amber-900"
        >
          {t('bake.stale')}
        </p>
      )}
      <p className="text-xs text-slate-500" data-testid="bake-info">
        {meta
          ? t('bake.ok')
              .replace('{look}', look)
              .replace('{s}', String(Math.round(meta.seconds)))
              .replace('{device}', meta.device)
          : t('bake.none')}
      </p>
      {!ready && s.health && <p className="text-xs text-amber-800">{t('bake.notReady')}</p>}
      <label className="flex items-center justify-between gap-2 text-xs text-slate-600">
        {t('bake.quality')}
        <select
          className="rounded border border-slate-300 bg-white px-1 py-0.5 text-xs"
          data-testid="bake-quality"
          value={s.quality}
          disabled={s.busy}
          onChange={(e) => s.patch({ quality: e.target.value as BakeQuality })}
        >
          {BAKE_QUALITIES.map((q) => (
            <option key={q} value={q}>
              {t(`bake.q.${q}` as 'bake.q.low')}
            </option>
          ))}
        </select>
      </label>
      <label className="flex items-center justify-between text-xs text-slate-600">
        {t('bake.auto')}
        <input
          type="checkbox"
          data-testid="bake-auto"
          checked={s.auto}
          onChange={(e) => s.patch({ auto: e.target.checked })}
        />
      </label>
      {s.busy ? (
        <div className="space-y-1" data-testid="bake-status">
          <progress
            className="w-full"
            max={s.job?.progress?.total ?? 1}
            value={s.job?.progress?.sample ?? 0}
          />
          <p className="text-xs tabular-nums">{status}</p>
          <button className={ghost} data-testid="bake-cancel" onClick={() => void s.cancel()}>
            {t('bake.cancel')}
          </button>
        </div>
      ) : (
        <div className="flex gap-1">
          <button
            className={btn}
            data-testid="bake-start"
            disabled={!ready}
            onClick={() => void s.start(preset)}
          >
            {meta ? t('bake.rebake') : t('bake.bake')} ({look})
          </button>
          {meta && (
            <button className={ghost} onClick={() => void s.remove(preset)}>
              {t('bake.remove')}
            </button>
          )}
        </div>
      )}
      {s.error && (
        <p role="alert" className="text-xs text-red-700">
          {s.error}
        </p>
      )}
    </div>
  );
}
