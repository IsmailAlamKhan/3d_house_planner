import { Clapperboard } from 'lucide-react';
import { useRef, useState } from 'react';
import { toast } from '../catalog/actions';
import { useT } from '../i18n';
import { useModel } from '../model/store';
import { PRESENT_LOOKS, PRESENT_PRESETS } from './presets';
import { applyLook, enterPresent, exitPresent, reframe } from './actions';
import { autoDecorate } from './decorate';
import type { LabelFont, LabelMode } from './labels';
import { usePresent } from './presentStore';
import { renderPresentation, exportPresentation } from './render';

const chip = (on: boolean) =>
  `rounded px-2 py-1 text-xs ${on ? 'bg-sky-700 font-semibold text-white' : 'bg-slate-100 text-slate-700 hover:bg-slate-200'}`;

/** The "Present" popover in the 3D toolbar: cutaway presets, looks, labels, auto-decorate, export and the still renderer. */
export function PresentPanel() {
  const t = useT();
  const [open, setOpen] = useState(false);
  const [scale, setScale] = useState<1 | 2 | 4>(2);
  const [withLabels, setWithLabels] = useState(true);
  const [transparent, setTransparent] = useState(false);
  const [busy, setBusy] = useState(false);
  const abort = useRef<AbortController | null>(null);
  const present = usePresent();
  const { active, preset, look, accent, fx, labels, hiddenLabels, pathTrace } = present;
  const project = useModel((s) => s.project);
  const activeLevelId = useModel((s) => s.activeLevelId);
  const rooms = project.rooms.filter(
    (r) => r.levelId === activeLevelId && r.name !== 'Open to below',
  );

  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    try {
      await fn();
    } catch (e) {
      toast(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const exportPng = () =>
    run(async () => {
      const r = await exportPresentation({
        scale,
        labels: withLabels,
        transparent,
        pathTrace: false,
      });
      toast(`${t('present.exported')} ${r.width} × ${r.height} px`);
    });

  const still = () =>
    run(async () => {
      const controller = new AbortController();
      abort.current = controller;
      present.setPathTrace({ running: true, samples: 0, fallback: null });
      try {
        const r = await exportPresentation({
          scale: 1,
          labels: withLabels,
          transparent: false,
          pathTrace: true,
          signal: controller.signal,
        });
        if (r.fallback) present.setPathTrace({ fallback: r.fallback });
        toast(
          r.cancelled
            ? t('present.stillCancelled')
            : r.fallback
              ? t('present.stillFallback')
              : t('present.exported'),
        );
      } finally {
        present.setPathTrace({ running: false });
        abort.current = null;
      }
    });

  void renderPresentation;
  const decorate = () => {
    const n = autoDecorate();
    toast(
      n > 0 ? t('present.decorated').replace('{n}', String(n)) : t('present.nothingToDecorate'),
    );
  };

  return (
    <div className="relative">
      <button
        title={t('present.title')}
        aria-label={t('present.title')}
        aria-expanded={open}
        data-testid="present-button"
        onClick={() => setOpen((o) => !o)}
        className={`rounded-md p-2 ${open || active ? 'bg-sky-100 text-sky-700' : 'text-slate-600 hover:bg-slate-100'}`}
      >
        <Clapperboard size={18} />
      </button>
      {open && (
        <div
          role="dialog"
          aria-label={t('present.title')}
          className="absolute right-0 top-full z-20 mt-1 max-h-[80vh] w-72 max-w-[calc(100vw-1rem)] space-y-3 overflow-auto rounded-lg border border-slate-200 bg-white p-3 text-sm shadow-lg"
        >
          <div role="group" aria-label={t('present.views')} className="space-y-1">
            <p className="text-xs font-medium text-slate-500">{t('present.views')}</p>
            <div className="grid grid-cols-1 gap-1">
              {PRESENT_PRESETS.map((p) => (
                <button
                  key={p}
                  data-testid={`present-${p}`}
                  aria-pressed={active && preset === p}
                  className={chip(active && preset === p)}
                  onClick={() => enterPresent(p)}
                >
                  {t(`present.preset.${p}` as 'present.preset.cutaway-top')}
                </button>
              ))}
            </div>
          </div>
          {active && (
            <>
              <div role="group" aria-label={t('present.look')} className="space-y-1">
                <p className="text-xs font-medium text-slate-500">{t('present.look')}</p>
                <div className="grid grid-cols-3 gap-1">
                  {PRESENT_LOOKS.map((l) => (
                    <button
                      key={l}
                      aria-pressed={look === l}
                      className={chip(look === l)}
                      onClick={() => applyLook(l)}
                    >
                      {t(`present.look.${l}` as 'present.look.dusk')}
                    </button>
                  ))}
                </div>
                <label className="flex items-center gap-2 text-xs">
                  <input
                    type="checkbox"
                    checked={accent}
                    onChange={(e) => present.patch({ accent: e.target.checked })}
                  />
                  {t('present.accent')}
                </label>
                <label className="flex items-center gap-2 text-xs">
                  <input
                    type="checkbox"
                    checked={fx}
                    onChange={(e) => present.patch({ fx: e.target.checked })}
                  />
                  {t('present.fx')}
                </label>
              </div>
              <div role="group" aria-label={t('present.labels')} className="space-y-1">
                <label className="flex items-center gap-2 text-xs font-medium">
                  <input
                    type="checkbox"
                    data-testid="present-labels-toggle"
                    checked={labels.show}
                    onChange={(e) => present.setLabels({ show: e.target.checked })}
                  />
                  {t('present.labels')}
                </label>
                {labels.show && (
                  <>
                    <div className="grid grid-cols-2 gap-1 text-xs">
                      <select
                        aria-label={t('present.labelMode')}
                        className="rounded border border-slate-300 px-1 py-0.5"
                        value={labels.mode}
                        onChange={(e) => present.setLabels({ mode: e.target.value as LabelMode })}
                      >
                        <option value="dims">{t('present.mode.dims')}</option>
                        <option value="area">{t('present.mode.area')}</option>
                        <option value="both">{t('present.mode.both')}</option>
                      </select>
                      <select
                        aria-label={t('present.labelFont')}
                        className="rounded border border-slate-300 px-1 py-0.5"
                        value={labels.font}
                        onChange={(e) => present.setLabels({ font: e.target.value as LabelFont })}
                      >
                        <option value="sans">{t('present.font.sans')}</option>
                        <option value="serif">{t('present.font.serif')}</option>
                        <option value="mono">{t('present.font.mono')}</option>
                      </select>
                    </div>
                    <label className="flex items-center gap-2 text-xs">
                      {t('present.labelSize')}
                      <input
                        type="range"
                        min={0.012}
                        max={0.04}
                        step={0.002}
                        value={labels.size}
                        onChange={(e) => present.setLabels({ size: Number(e.target.value) })}
                      />
                    </label>
                    <label className="flex items-center gap-2 text-xs">
                      <input
                        type="checkbox"
                        checked={labels.backdrop === 'pill'}
                        onChange={(e) =>
                          present.setLabels({ backdrop: e.target.checked ? 'pill' : 'shadow' })
                        }
                      />
                      {t('present.pill')}
                    </label>
                    {rooms.length > 0 && (
                      <details className="text-xs">
                        <summary className="cursor-pointer">{t('present.perRoom')}</summary>
                        <ul className="mt-1 space-y-0.5">
                          {rooms.map((r) => (
                            <li key={r.id}>
                              <label className="flex items-center gap-2">
                                <input
                                  type="checkbox"
                                  checked={!hiddenLabels.includes(r.id)}
                                  onChange={() => present.toggleRoomLabel(r.id)}
                                />
                                {r.name}
                              </label>
                            </li>
                          ))}
                        </ul>
                      </details>
                    )}
                  </>
                )}
              </div>
            </>
          )}
          <button
            className={`${chip(false)} w-full`}
            data-testid="present-decorate"
            onClick={decorate}
          >
            {t('present.autoDecorate')}
          </button>
          {active && (
            <>
              <div role="group" aria-label={t('present.export')} className="space-y-1">
                <p className="text-xs font-medium text-slate-500">{t('present.export')}</p>
                <div className="grid grid-cols-3 gap-1">
                  {([1, 2, 4] as const).map((s) => (
                    <button
                      key={s}
                      aria-pressed={scale === s}
                      className={chip(scale === s)}
                      onClick={() => setScale(s)}
                    >
                      {s}×
                    </button>
                  ))}
                </div>
                <label className="flex items-center gap-2 text-xs">
                  <input
                    type="checkbox"
                    checked={withLabels}
                    onChange={(e) => setWithLabels(e.target.checked)}
                  />
                  {t('present.withLabels')}
                </label>
                <label className="flex items-center gap-2 text-xs">
                  <input
                    type="checkbox"
                    checked={transparent}
                    onChange={(e) => setTransparent(e.target.checked)}
                  />
                  {t('present.transparent')}
                </label>
                <button
                  className="w-full rounded-md bg-slate-800 px-3 py-1.5 text-sm text-white hover:bg-slate-700 disabled:opacity-50"
                  data-testid="present-export"
                  disabled={busy}
                  onClick={() => void exportPng()}
                >
                  {t('present.exportPng')} {scale}×
                </button>
              </div>
              <div role="group" aria-label={t('present.still')} className="space-y-1">
                <p className="text-xs font-medium text-slate-500">{t('present.still')}</p>
                <label className="flex items-center justify-between gap-2 text-xs">
                  {t('present.samples')}
                  <input
                    type="number"
                    min={10}
                    max={2000}
                    step={10}
                    className="w-20 rounded border border-slate-300 px-1"
                    value={pathTrace.target}
                    disabled={pathTrace.running}
                    onChange={(e) =>
                      present.setPathTrace({ target: Math.max(10, Number(e.target.value) || 200) })
                    }
                  />
                </label>
                {pathTrace.running ? (
                  <>
                    <progress
                      className="w-full"
                      data-testid="present-progress"
                      max={pathTrace.target}
                      value={pathTrace.samples}
                    />
                    <p className="text-xs tabular-nums" data-testid="present-samples">
                      {t('present.sampling')
                        .replace('{n}', String(pathTrace.samples))
                        .replace('{max}', String(pathTrace.target))}
                    </p>
                    <button
                      className={`${chip(false)} w-full`}
                      data-testid="present-cancel"
                      onClick={() => abort.current?.abort()}
                    >
                      {t('present.cancel')}
                    </button>
                  </>
                ) : (
                  <button
                    className={`${chip(false)} w-full`}
                    data-testid="present-still"
                    disabled={busy}
                    onClick={() => void still()}
                  >
                    {t('present.highQuality')}
                  </button>
                )}
                {pathTrace.fallback && (
                  <p role="status" className="text-xs text-amber-700">
                    {t('present.stillFallback')}
                  </p>
                )}
              </div>
              <div className="flex gap-1">
                <button className={`${chip(false)} flex-1`} onClick={reframe}>
                  {t('present.reframe')}
                </button>
                <button className={`${chip(false)} flex-1`} onClick={exitPresent}>
                  {t('present.leave')}
                </button>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}
