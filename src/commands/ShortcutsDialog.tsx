import { X } from 'lucide-react';
import { useT } from '../i18n';
import { Modal } from '../ui/Modal';
import { useUiStore } from '../ui/uiStore';
import { formatShortcut } from './keys';
import { SHORTCUTS } from './shortcuts';

/** The "?" sheet: every shortcut, grouped. */
export function ShortcutsDialog() {
  const t = useT();
  const open = useUiStore((s) => s.shortcutsOpen);
  const setOpen = useUiStore((s) => s.setShortcutsOpen);
  if (!open) return null;
  return (
    <Modal
      open
      onClose={() => setOpen(false)}
      label={t('kb.sheet')}
      className="max-w-2xl"
      placement="sheet"
    >
      <div className="flex items-center border-b border-slate-200 px-4 py-3">
        <h2 className="flex-1 font-semibold">{t('kb.sheet')}</h2>
        <button
          aria-label={t('drawer.close')}
          className="rounded p-1 hover:bg-slate-100"
          onClick={() => setOpen(false)}
        >
          <X size={16} />
        </button>
      </div>
      <div className="grid min-h-0 flex-1 gap-x-8 gap-y-4 overflow-auto p-4 sm:grid-cols-2">
        {SHORTCUTS.map((g) => (
          <section key={g.title} aria-label={t(g.title)}>
            <h3 className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-500">
              {t(g.title)}
            </h3>
            <dl className="space-y-1">
              {g.items.map((i) => (
                <div
                  key={`${i.keys}-${i.label}`}
                  className="flex items-center justify-between gap-3 text-sm"
                >
                  <dt>{t(i.label)}</dt>
                  <dd>
                    <kbd className="rounded border border-slate-300 bg-slate-50 px-1.5 py-0.5 text-xs text-slate-600">
                      {formatShortcut(i.keys)}
                    </kbd>
                  </dd>
                </div>
              ))}
            </dl>
          </section>
        ))}
      </div>
    </Modal>
  );
}
