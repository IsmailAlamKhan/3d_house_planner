import { CircleHelp, Command, Keyboard, Route } from 'lucide-react';
import { formatShortcut } from '../commands/keys';
import { useT } from '../i18n';
import { startTour } from '../onboarding/tourStore';
import { PopoverMenu } from '../ui/PopoverMenu';
import { useUiStore } from '../ui/uiStore';

const item =
  'flex w-full items-center justify-between gap-3 rounded px-2 py-1.5 text-left text-sm hover:bg-slate-100';

/** Help: replay the tour, the shortcut sheet and the command palette. */
export function HelpMenu() {
  const t = useT();
  return (
    <PopoverMenu label={t('help.title')} icon={<CircleHelp size={18} />} tourId="help">
      {(close) => (
        <div className="w-64">
          <button
            role="menuitem"
            className={item}
            onClick={() => {
              close();
              startTour();
            }}
          >
            <span className="flex items-center gap-2">
              <Route size={14} /> {t('help.tour')}
            </span>
          </button>
          <button
            role="menuitem"
            className={item}
            onClick={() => {
              close();
              useUiStore.getState().setShortcutsOpen(true);
            }}
          >
            <span className="flex items-center gap-2">
              <Keyboard size={14} /> {t('kb.sheet')}
            </span>
            <kbd className="rounded border border-slate-300 bg-slate-50 px-1 text-xs">?</kbd>
          </button>
          <button
            role="menuitem"
            className={item}
            onClick={() => {
              close();
              useUiStore.getState().setPaletteOpen(true);
            }}
          >
            <span className="flex items-center gap-2">
              <Command size={14} /> {t('kb.palette')}
            </span>
            <kbd className="rounded border border-slate-300 bg-slate-50 px-1 text-xs">
              {formatShortcut('Mod+K')}
            </kbd>
          </button>
        </div>
      )}
    </PopoverMenu>
  );
}
