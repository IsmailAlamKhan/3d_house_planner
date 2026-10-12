import { useT } from '../i18n';

export function RightSidebar() {
  const t = useT();
  return (
    <div className="flex h-full flex-col">
      <h2 className="border-b border-slate-200 px-3 py-2 text-sm font-semibold">
        {t('properties.title')}
      </h2>
      <p className="p-3 text-sm text-slate-500">{t('properties.empty')}</p>
    </div>
  );
}
