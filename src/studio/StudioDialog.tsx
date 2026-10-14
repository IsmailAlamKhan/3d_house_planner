import { useEffect, useState } from 'react';
import { downloadBlob, safeFileName } from '../export/download';
import { useT } from '../i18n';
import { useModel } from '../model/store';
import { composePicture } from '../present/render';
import { Modal } from '../ui/Modal';
import { studioPictureUrl } from './api';
import {
  ENABLE_STUDIO_COMMAND,
  QUALITY_PRESETS,
  STUDIO_QUALITIES,
  type StudioResultMeta,
} from './protocol';
import { useStudio } from './studioStore';

const btn =
  'rounded-md bg-slate-800 px-3 py-1.5 text-sm text-white hover:bg-slate-700 disabled:opacity-50';
const ghost =
  'rounded-md border border-slate-300 px-2 py-1 text-xs hover:bg-slate-100 disabled:opacity-50';

/** The studio picture with the room labels drawn on it again (vector text, crisp at any size). */
function useLabelled(meta: StudioResultMeta | undefined): { url: string; blob: Blob } | null {
  const [pic, setPic] = useState<{ id: string; url: string; blob: Blob } | null>(null);
  useEffect(() => {
    let dead = false;
    let made: string | null = null;
    if (!meta) return;
    void (async () => {
      const raw = await fetch(studioPictureUrl(meta.id)).then((r) => r.blob());
      const blob =
        meta.viewProjection.length === 16
          ? await composePicture(
              {
                blob: raw,
                width: meta.width,
                height: meta.height,
                scale: 1,
                viewProjection: meta.viewProjection,
              },
              { labels: true },
            )
          : raw;
      if (dead) return;
      made = URL.createObjectURL(blob);
      setPic({ id: meta.id, url: made, blob });
    })().catch(() => undefined);
    return () => {
      dead = true;
      if (made) URL.revokeObjectURL(made);
    };
  }, [meta]);
  return pic && pic.id === meta?.id ? pic : null;
}

/** "Studio render (Blender)": Cycles stills on the GPU, with progress, cancel and the results gallery. */
export function StudioDialog() {
  const t = useT();
  const s = useStudio();
  const projectId = useModel((m) => m.project.id);
  const ready = !!s.health?.ready;
  const selected = s.gallery.find((g) => g.id === s.selectedId);
  const pic = useLabelled(selected);

  useEffect(() => {
    if (s.open) void s.loadGallery();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId, s.open]);

  const status = (() => {
    if (s.phase === 'preparing') return t('studio.preparing');
    const j = s.job;
    if (!j) return s.phase === 'waiting' ? t('studio.sending') : '';
    if (j.status === 'queued')
      return j.ahead > 0
        ? t('studio.queued').replace('{n}', String(j.ahead))
        : t('studio.starting');
    if (j.status === 'running' && j.progress) {
      const eta = j.progress.etaSeconds;
      return (
        t('studio.sampling')
          .replace('{n}', String(j.progress.sample))
          .replace('{max}', String(j.progress.total)) +
        (eta ? ` · ${t('studio.eta').replace('{s}', String(eta))}` : '')
      );
    }
    return j.status === 'running' ? t('studio.starting') : '';
  })();

  return (
    <Modal
      open={s.open}
      onClose={() => s.setOpen(false)}
      label={t('studio.title')}
      className="max-w-4xl"
      placement="sheet"
    >
      <>
        <div className="flex items-center border-b border-slate-200 px-4 py-3">
          <h2 className="flex-1 font-semibold">{t('studio.title')}</h2>
          <button className={ghost} onClick={() => s.setOpen(false)}>
            {t('studio.close')}
          </button>
        </div>
        <div className="grid min-h-0 flex-1 gap-4 overflow-auto p-4 md:grid-cols-2">
          <section className="space-y-3 text-sm" aria-label={t('studio.settings')}>
            {s.health && !ready && (
              <div
                role="status"
                data-testid="studio-unavailable"
                className="rounded-md border border-amber-300 bg-amber-50 p-3 text-xs text-amber-900"
              >
                <p className="font-medium">
                  {s.health.configured ? t('studio.notReady') : t('studio.notSetUp')}
                </p>
                <p className="mt-1">
                  {s.health.configured
                    ? (s.health.problem ?? '')
                    : t('studio.howTo').replace('{cmd}', ENABLE_STUDIO_COMMAND)}
                </p>
                <button className={`${ghost} mt-2`} onClick={() => void s.refreshHealth()}>
                  {t('studio.check')}
                </button>
              </div>
            )}
            {ready && s.health?.device && (
              <p className="text-xs text-slate-500" data-testid="studio-device">
                {s.health.device} · Blender {s.health.version}
              </p>
            )}
            <label className="block text-xs font-medium text-slate-600">
              {t('studio.quality')}
              <select
                className="mt-1 w-full rounded border border-slate-300 px-2 py-1 text-sm"
                data-testid="studio-quality"
                value={s.quality}
                disabled={s.busy}
                onChange={(e) => s.patch({ quality: e.target.value as typeof s.quality })}
              >
                {STUDIO_QUALITIES.map((q) => (
                  <option key={q} value={q}>
                    {t(`studio.q.${q}` as 'studio.q.preview')} ({QUALITY_PRESETS[q].samples} ·{' '}
                    {QUALITY_PRESETS[q].longSide} px)
                  </option>
                ))}
              </select>
            </label>
            <div className="flex flex-col gap-2">
              <button
                className={btn}
                data-testid="studio-render"
                disabled={!ready || s.busy}
                onClick={() => void s.start('current')}
              >
                {t('studio.render')}
              </button>
              <button
                className={btn}
                data-testid="studio-reference"
                disabled={!ready || s.busy}
                onClick={() => void s.start('reference')}
              >
                {t('studio.reference')}
              </button>
              <p className="text-xs text-slate-500">{t('studio.referenceHint')}</p>
            </div>
            {s.busy && (
              <div className="space-y-1" data-testid="studio-status">
                <progress
                  className="w-full"
                  max={s.job?.progress?.total ?? 1}
                  value={s.job?.progress?.sample ?? 0}
                  data-testid="studio-progress"
                />
                <p className="text-xs tabular-nums">{status}</p>
                <button
                  className={ghost}
                  data-testid="studio-cancel"
                  onClick={() => void s.cancel()}
                >
                  {t('studio.cancel')}
                </button>
              </div>
            )}
            {s.error && (
              <p role="alert" className="text-xs text-red-700">
                {s.error}
              </p>
            )}
          </section>
          <section className="space-y-2" aria-label={t('studio.gallery')}>
            <h3 className="text-sm font-medium">{t('studio.gallery')}</h3>
            {s.gallery.length === 0 && (
              <p className="text-xs text-slate-500">{t('studio.empty')}</p>
            )}
            {selected && pic && (
              <>
                <img
                  src={pic.url}
                  alt={selected.projectName}
                  data-testid="studio-picture"
                  className="w-full rounded border border-slate-200"
                />
                <p className="text-xs text-slate-500">
                  {t('studio.info')
                    .replace('{w}', String(selected.width))
                    .replace('{h}', String(selected.height))
                    .replace('{samples}', String(selected.samples))
                    .replace('{s}', String(Math.round(selected.seconds)))}
                </p>
                <div className="flex gap-2">
                  <button
                    className={ghost}
                    onClick={() =>
                      downloadBlob(
                        pic.blob,
                        `${safeFileName(selected.projectName)}-studio-${selected.look}.png`,
                      )
                    }
                  >
                    {t('studio.download')}
                  </button>
                  <button className={ghost} onClick={() => void s.remove(selected.id)}>
                    {t('studio.delete')}
                  </button>
                </div>
              </>
            )}
            {s.gallery.length > 1 && (
              <ul className="flex flex-wrap gap-1" aria-label={t('studio.gallery')}>
                {s.gallery.map((g, i) => (
                  <li key={g.id}>
                    <button
                      className={`${ghost} ${g.id === s.selectedId ? 'bg-sky-100' : ''}`}
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
