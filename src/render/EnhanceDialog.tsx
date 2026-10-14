import { useEffect, useState } from 'react';
import { downloadBlob, safeFileName } from '../export/download';
import { useT } from '../i18n';
import { useModel } from '../model/store';
import { usePresent } from '../present/presentStore';
import { Modal } from '../ui/Modal';
import { beforeUrl, resultUrl, styleUrl } from './api';
import { composeOver } from './compose';
import { useEnhance } from './enhanceStore';
import { ENHANCE_PRESETS } from './presets';
import { randomSeed } from './enhance';
import {
  CREATIVITY_RANGE,
  ENABLE_RENDER_COMMAND,
  type ResultMeta,
  WATCH_RENDER_COMMAND,
} from './protocol';
import { STYLE_PRESETS } from './promptBuilder';

const btn =
  'rounded-md bg-slate-800 px-3 py-1.5 text-sm text-white hover:bg-slate-700 disabled:opacity-50';
const ghost =
  'rounded-md border border-slate-300 px-2 py-1 text-xs hover:bg-slate-100 disabled:opacity-50';
const field = 'w-full rounded border border-slate-300 px-2 py-1 text-sm';

/** Builds the two pictures to compare: the exact render and the AI version, both with crisp labels re-applied. */
function usePictures(meta: ResultMeta | undefined) {
  const labelStyle = usePresent((s) => s.labels);
  const [urls, setUrls] = useState<{ before: string; after: string } | null>(null);
  useEffect(() => {
    let dead = false;
    if (!meta) {
      queueMicrotask(() => !dead && setUrls(null));
      return () => void (dead = true);
    }
    const made: string[] = [];
    void (async () => {
      const opts = {
        labels: meta.labels,
        viewProjection: meta.view.viewProjection,
        style: labelStyle,
      };
      const [before, after] = await Promise.all([
        composeOver(beforeUrl(meta.id), { ...opts, badge: false }),
        composeOver(resultUrl(meta.id), { ...opts, badge: true }),
      ]);
      if (dead) return;
      const b = URL.createObjectURL(before);
      const a = URL.createObjectURL(after);
      made.push(a, b);
      setUrls({ before: b, after: a });
      pictures.set(meta.id, after);
    })().catch(() => setUrls(null));
    return () => {
      dead = true;
      made.forEach((u) => URL.revokeObjectURL(u));
    };
  }, [meta, labelStyle]);
  return urls;
}
const pictures = new Map<string, Blob>();

/** The exact render on the left of the handle, the AI version on the right. */
function BeforeAfter({ before, after, label }: { before: string; after: string; label: string }) {
  const [pos, setPos] = useState(50);
  return (
    <div
      className="relative select-none overflow-hidden rounded-md border border-slate-200"
      data-testid="before-after"
    >
      <img src={before} alt="" className="block w-full" draggable={false} />
      <img
        src={after}
        alt={label}
        className="absolute inset-0 h-full w-full"
        style={{ clipPath: `inset(0 0 0 ${pos}%)` }}
        draggable={false}
      />
      <div
        aria-hidden
        className="pointer-events-none absolute inset-y-0 w-0.5 bg-white shadow"
        style={{ left: `${pos}%` }}
      />
      <input
        type="range"
        min={0}
        max={100}
        value={pos}
        aria-label={label}
        data-testid="before-after-slider"
        onChange={(e) => setPos(Number(e.target.value))}
        className="absolute inset-x-2 bottom-2 w-[calc(100%-1rem)]"
      />
    </div>
  );
}

/** "Enhance render": AI image enhancement through ComfyUI, with the results gallery. */
export function EnhanceDialog() {
  const t = useT();
  const s = useEnhance();
  const projectId = useModel((m) => m.project.id);
  const available = !!s.health?.configured && !!s.health.reachable;
  const selected = s.gallery.find((g) => g.id === s.selectedId);
  const urls = usePictures(selected);

  useEffect(() => {
    if (s.open) void s.loadGallery();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId, s.open]);

  const status = (() => {
    if (s.phase === 'capturing') return t('enhance.capturing');
    const j = s.job;
    if (!j) return '';
    if (j.status === 'queued')
      return j.ahead > 0
        ? t('enhance.queued')
            .replace('{n}', String(j.ahead))
            .replace(
              '{what}',
              j.gpuBusyWith === 'design' ? t('enhance.busyDesign') : t('enhance.busyRender'),
            )
        : t('enhance.starting');
    if (j.status === 'running')
      return j.progress && j.progress.max
        ? t('enhance.step')
            .replace('{n}', String(j.progress.step))
            .replace('{max}', String(j.progress.max))
        : t('enhance.running');
    return '';
  })();

  const download = async (meta: ResultMeta) => {
    const blob = pictures.get(meta.id);
    if (blob)
      downloadBlob(blob, `${safeFileName(meta.projectName)}-enhanced-${meta.params.seed}.png`);
  };

  return (
    <Modal
      open={s.open}
      onClose={() => s.setOpen(false)}
      label={t('enhance.title')}
      className="max-w-4xl"
      placement="sheet"
    >
      <>
        <div className="flex items-center border-b border-slate-200 px-4 py-3">
          <h2 className="flex-1 font-semibold">{t('enhance.title')}</h2>
          <button className={ghost} onClick={() => s.setOpen(false)}>
            {t('enhance.close')}
          </button>
        </div>
        <div className="grid min-h-0 flex-1 gap-4 overflow-auto p-4 md:grid-cols-2">
          <section className="space-y-3 text-sm" aria-label={t('enhance.settings')}>
            {!available && (
              <div
                role="status"
                data-testid="enhance-unavailable"
                className="rounded-md border border-amber-300 bg-amber-50 p-3 text-xs text-amber-900"
              >
                <p>
                  {s.health === null
                    ? t('enhance.checking')
                    : s.health.configured
                      ? t('enhance.notRunning')
                      : t('enhance.notConfigured')}
                </p>
                <code className="mt-1 block select-all rounded bg-white px-2 py-1 font-mono">
                  {s.health?.configured ? WATCH_RENDER_COMMAND : ENABLE_RENDER_COMMAND}
                </code>
                <button className={`${ghost} mt-2`} onClick={() => void s.refreshHealth()}>
                  {t('enhance.recheck')}
                </button>
              </div>
            )}
            <div role="group" aria-label={t('enhance.preset')} className="flex flex-wrap gap-1">
              {ENHANCE_PRESETS.map((id) => (
                <button
                  key={id}
                  data-testid={`enhance-preset-${id}`}
                  aria-pressed={s.preset === id}
                  className={`rounded px-2 py-1 text-xs ${s.preset === id ? 'bg-emerald-700 font-semibold text-white' : 'bg-slate-100 hover:bg-slate-200'}`}
                  onClick={() => s.applyPreset(id)}
                >
                  {t(`enhance.preset.${id}` as 'enhance.preset.reference')}
                </button>
              ))}
            </div>
            {s.preset !== 'classic' && (
              <div
                className="space-y-2 rounded-md border border-slate-200 p-2 text-xs"
                data-testid="enhance-v2"
              >
                <label className="block">
                  {t('enhance.source')}
                  <select
                    className={field}
                    data-testid="enhance-source"
                    value={s.source}
                    onChange={(e) => s.patch({ source: e.target.value as 'studio' | 'live' })}
                  >
                    <option value="studio">{t('enhance.source.studio')}</option>
                    <option value="live">{t('enhance.source.live')}</option>
                  </select>
                </label>
                <label className="block">
                  {t('enhance.styleRef')}
                  <select
                    className={field}
                    data-testid="enhance-style-ref"
                    value={s.styleRef}
                    onChange={(e) =>
                      s.patch({ styleRef: e.target.value as 'none' | 'reference' | 'upload' })
                    }
                  >
                    <option value="none">{t('enhance.styleRef.none')}</option>
                    <option value="reference">{t('enhance.styleRef.reference')}</option>
                    <option value="upload" disabled={!s.styleUpload}>
                      {s.styleUpload ? t('enhance.reference') : t('enhance.styleRef.upload')}
                    </option>
                  </select>
                </label>
                <label className="block">
                  <span className="sr-only">{t('enhance.styleRef.upload')}</span>
                  <input
                    type="file"
                    accept="image/*"
                    data-testid="enhance-style-file"
                    onChange={(e) => {
                      const f = e.target.files?.[0];
                      if (f) void s.chooseStyleFile(f);
                    }}
                  />
                </label>
                {s.styleRef !== 'none' && s.health?.capabilities?.styleReference === false && (
                  <p className="text-amber-700">{t('enhance.styleUnavailable')}</p>
                )}
                {s.styleRef !== 'none' && (
                  <label className="block">
                    <span className="flex justify-between">
                      {t('enhance.ipWeight')}
                      <b className="tabular-nums">{s.ipWeight.toFixed(2)}</b>
                    </span>
                    <input
                      type="range"
                      className="w-full"
                      data-testid="enhance-ip-weight"
                      min={0.1}
                      max={1.2}
                      step={0.05}
                      value={s.ipWeight}
                      onChange={(e) => s.patch({ ipWeight: Number(e.target.value) })}
                    />
                  </label>
                )}
                <label className="block">
                  <span className="flex justify-between">
                    {t('enhance.edgeStrength')}
                    <b className="tabular-nums">{s.edgeStrength.toFixed(2)}</b>
                  </span>
                  <input
                    type="range"
                    className="w-full"
                    min={0}
                    max={1.2}
                    step={0.05}
                    value={s.edgeStrength}
                    onChange={(e) => s.patch({ edgeStrength: Number(e.target.value) })}
                  />
                </label>
                <label className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    data-testid="enhance-regions"
                    checked={s.regions}
                    onChange={(e) => s.patch({ regions: e.target.checked })}
                  />
                  {t('enhance.regions')}
                </label>
                <label className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={s.layoutCheck}
                    onChange={(e) => s.patch({ layoutCheck: e.target.checked })}
                  />
                  {t('enhance.layoutCheck')}
                </label>
                <label className="block">
                  {t('enhance.tiled')}
                  <select
                    className={field}
                    value={s.tiledUpscale}
                    onChange={(e) => s.patch({ tiledUpscale: Number(e.target.value) as 0 | 2 | 3 })}
                  >
                    <option value={0}>{t('enhance.tiled.off')}</option>
                    <option value={2} disabled={s.health?.capabilities?.tiledUpscale === false}>
                      2×
                    </option>
                    <option value={3} disabled={s.health?.capabilities?.tiledUpscale === false}>
                      3×
                    </option>
                  </select>
                </label>
                {(s.health?.capabilities?.checkpoints.length ?? 0) > 1 && (
                  <label className="block">
                    {t('enhance.checkpoint')}
                    <select
                      className={field}
                      data-testid="enhance-checkpoint"
                      value={s.checkpoint}
                      onChange={(e) => s.patch({ checkpoint: e.target.value })}
                    >
                      <option value="">{t('enhance.checkpoint.default')}</option>
                      {s
                        .health!.capabilities!.checkpoints.filter(
                          (c) => !/sd_xl_base_1\.0/i.test(c),
                        )
                        .map((c) => (
                          <option key={c} value={c}>
                            {c}
                          </option>
                        ))}
                    </select>
                    <span className="mt-1 block text-slate-500">{t('enhance.checkpointNote')}</span>
                  </label>
                )}
              </div>
            )}
            {s.note === 'noStudio' && (
              <p role="status" className="text-xs text-amber-700" data-testid="enhance-no-studio">
                {t('enhance.noStudio')}
              </p>
            )}
            <div role="group" aria-label={t('enhance.style')} className="flex flex-wrap gap-1">
              {STYLE_PRESETS.map((p) => (
                <button
                  key={p.id}
                  aria-pressed={s.style === p.id}
                  className={`rounded px-2 py-1 text-xs ${s.style === p.id ? 'bg-sky-700 font-semibold text-white' : 'bg-slate-100 hover:bg-slate-200'}`}
                  onClick={() => {
                    s.patch({ style: p.id });
                    setTimeout(
                      () =>
                        !useEnhance.getState().promptEdited &&
                        useEnhance.getState().rebuildPrompt(),
                      0,
                    );
                  }}
                >
                  {t(`enhance.style.${p.id}` as 'enhance.style.classic')}
                </button>
              ))}
            </div>
            <label className="block">
              <span className="flex items-center justify-between text-xs font-medium text-slate-600">
                {t('enhance.prompt')}
                <button className="text-sky-700 underline" onClick={() => s.rebuildPrompt()}>
                  {t('enhance.rebuild')}
                </button>
              </span>
              <textarea
                className={`${field} h-28`}
                data-testid="enhance-prompt"
                value={s.prompt}
                onChange={(e) => s.patch({ prompt: e.target.value, promptEdited: true })}
              />
            </label>
            <label className="block">
              <span className="text-xs font-medium text-slate-600">{t('enhance.negative')}</span>
              <textarea
                className={`${field} h-16`}
                value={s.negative}
                onChange={(e) => s.patch({ negative: e.target.value })}
              />
            </label>
            <label className="block text-xs">
              <span className="flex justify-between">
                {t('enhance.creativity')}
                <b className="tabular-nums">{s.creativity.toFixed(2)}</b>
              </span>
              <input
                type="range"
                className="w-full"
                min={CREATIVITY_RANGE.min}
                max={CREATIVITY_RANGE.max}
                step={0.01}
                value={s.creativity}
                onChange={(e) => s.patch({ creativity: Number(e.target.value) })}
              />
            </label>
            <label className="block text-xs">
              <span className="flex justify-between">
                {t('enhance.control')}
                <b className="tabular-nums">{s.controlStrength.toFixed(2)}</b>
              </span>
              <input
                type="range"
                className="w-full"
                min={0.2}
                max={1.2}
                step={0.05}
                value={s.controlStrength}
                onChange={(e) => s.patch({ controlStrength: Number(e.target.value) })}
              />
            </label>
            <div className="grid grid-cols-2 gap-2 text-xs">
              <label>
                {t('enhance.steps')}
                <input
                  type="number"
                  className={field}
                  min={8}
                  max={60}
                  value={s.steps}
                  onChange={(e) =>
                    s.patch({ steps: Math.min(60, Math.max(8, Number(e.target.value) || 28)) })
                  }
                />
              </label>
              <label>
                {t('enhance.seed')}
                <span className="flex gap-1">
                  <input
                    type="number"
                    className={field}
                    min={0}
                    value={s.seed}
                    onChange={(e) =>
                      s.patch({ seed: Math.max(0, Math.floor(Number(e.target.value) || 0)) })
                    }
                  />
                  <button
                    className={ghost}
                    title={t('enhance.randomSeed')}
                    onClick={() => s.patch({ seed: randomSeed() })}
                  >
                    🎲
                  </button>
                </span>
              </label>
            </div>
            <label className="flex items-center gap-2 text-xs">
              <input
                type="checkbox"
                checked={s.useEdges}
                onChange={(e) => s.patch({ useEdges: e.target.checked })}
              />
              {t('enhance.edges')}
            </label>
            <label className="flex items-center gap-2 text-xs">
              <input
                type="checkbox"
                checked={s.upscale}
                onChange={(e) => s.patch({ upscale: e.target.checked })}
              />
              {t('enhance.upscale')}
            </label>
            <p className="text-xs text-slate-500">{t('enhance.labelsNote')}</p>
            <div className="flex items-center gap-2">
              <button
                className={btn}
                data-testid="enhance-run"
                disabled={!available || s.busy || s.prompt.trim().length < 3}
                onClick={() => void s.start()}
              >
                {t('enhance.run')}
              </button>
              {s.busy && (
                <button
                  className={ghost}
                  data-testid="enhance-cancel"
                  onClick={() => void s.cancel()}
                >
                  {t('enhance.cancel')}
                </button>
              )}
            </div>
            {status && (
              <p role="status" data-testid="enhance-status" className="text-xs tabular-nums">
                {status}
              </p>
            )}
            {s.busy && s.job?.progress?.max ? (
              <progress className="w-full" max={s.job.progress.max} value={s.job.progress.step} />
            ) : null}
            {s.error && (
              <p role="alert" className="text-xs text-red-600">
                {s.error}
              </p>
            )}
          </section>

          <section className="space-y-2" aria-label={t('enhance.gallery')}>
            <h3 className="text-sm font-medium">{t('enhance.gallery')}</h3>
            {s.gallery.length === 0 && (
              <p className="text-xs text-slate-500">{t('enhance.empty')}</p>
            )}
            {selected && urls && (
              <BeforeAfter before={urls.before} after={urls.after} label={t('enhance.compare')} />
            )}
            {selected && selected.params.ipWeight > 0 && (
              <figure className="space-y-1" data-testid="enhance-reference">
                <img
                  src={styleUrl(selected.id)}
                  alt={t('enhance.reference')}
                  className="max-h-40 rounded border border-slate-200"
                />
                <figcaption className="text-xs text-slate-500">{t('enhance.compare3')}</figcaption>
              </figure>
            )}
            {selected?.layoutScore !== undefined && (
              <p
                className={`text-xs ${selected.layoutScore < 0.55 ? 'text-amber-700' : 'text-slate-600'}`}
                data-testid="enhance-layout"
              >
                {t('enhance.layoutScore').replace(
                  '{pct}',
                  String(Math.round(selected.layoutScore * 100)),
                )}
                {selected.retries
                  ? ` · ${t('enhance.layoutRetried').replace('{n}', String(selected.retries))}`
                  : ''}
                {selected.layoutScore < 0.55 ? ` — ${t('enhance.layoutWarn')}` : ''}
              </p>
            )}
            {selected && (
              <>
                <p className="text-xs text-slate-500">
                  {t('enhance.info')
                    .replace('{seed}', String(selected.params.seed))
                    .replace('{creativity}', selected.params.creativity.toFixed(2))
                    .replace('{steps}', String(selected.params.steps))}
                </p>
                <div className="flex flex-wrap gap-1">
                  <button
                    className={ghost}
                    data-testid="enhance-rerun"
                    disabled={s.busy || !available}
                    onClick={() => void s.rerun(selected.id)}
                  >
                    {t('enhance.rerun')}
                  </button>
                  <button className={ghost} onClick={() => void download(selected)}>
                    {t('enhance.download')}
                  </button>
                  <button className={ghost} onClick={() => void s.remove(selected.id)}>
                    {t('enhance.delete')}
                  </button>
                </div>
              </>
            )}
            {s.gallery.length > 1 && (
              <ul className="flex flex-wrap gap-1" aria-label={t('enhance.gallery')}>
                {s.gallery.map((g, i) => (
                  <li key={g.id}>
                    <button
                      className={`rounded px-2 py-1 text-xs ${g.id === s.selectedId ? 'bg-sky-700 text-white' : 'bg-slate-100 hover:bg-slate-200'}`}
                      aria-pressed={g.id === s.selectedId}
                      onClick={() => s.patch({ selectedId: g.id })}
                    >
                      #{s.gallery.length - i}
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>
      </>
    </Modal>
  );
}
