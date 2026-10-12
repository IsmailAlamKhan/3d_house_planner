import { useT } from '../i18n';

export function StatusBar() {
  const t = useT();
  return (
    <footer className="flex items-center gap-4 border-t border-slate-200 bg-white px-3 py-1 text-xs text-slate-600">
      <span>{t('status.units')}: m</span>
      <span>
        {t('status.snap')}: {t('status.on')}
      </span>
      <span className="ml-auto tabular-nums">{t('status.cursor')}: 0.00, 0.00</span>
    </footer>
  );
}
