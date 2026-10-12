import { Download } from 'lucide-react';
import { useEffect } from 'react';
import { useT } from '../i18n';
import { usePwa } from './pwaStore';

/** Small notices: ready for offline use, a new version is waiting, or "install this app". */
export function PwaBanner() {
  const t = useT();
  const { offlineReady, needRefresh, installEvent, update, dismiss, install } = usePwa();
  useEffect(() => {
    if (!offlineReady) return;
    const id = setTimeout(dismiss, 6000);
    return () => clearTimeout(id);
  }, [offlineReady, dismiss]);
  const message = needRefresh
    ? t('pwa.updateReady')
    : offlineReady
      ? t('pwa.offlineReady')
      : installEvent
        ? t('pwa.installHint')
        : null;
  if (!message) return null;
  return (
    <div
      role="status"
      data-testid="pwa-banner"
      className="anim-panel fixed bottom-14 left-3 z-40 flex max-w-sm items-center gap-3 rounded-lg border border-slate-200 bg-white p-3 text-sm text-slate-800 shadow-lg"
    >
      <span className="flex-1">{message}</span>
      {needRefresh && (
        <button
          className="rounded-md bg-sky-700 px-3 py-1 text-white hover:bg-sky-800"
          onClick={() => update?.()}
        >
          {t('pwa.update')}
        </button>
      )}
      {!needRefresh && !offlineReady && installEvent && (
        <button
          className="inline-flex items-center gap-1 rounded-md bg-sky-700 px-3 py-1 text-white hover:bg-sky-800"
          onClick={() => void install()}
        >
          <Download size={14} /> {t('pwa.install')}
        </button>
      )}
      <button className="rounded-md px-2 py-1 hover:bg-slate-100" onClick={dismiss}>
        {t('pwa.dismiss')}
      </button>
    </div>
  );
}
