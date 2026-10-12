import { Search } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { toast } from '../catalog/actions';
import { t, useT } from '../i18n';
import { saveNow } from '../persistence/autosave';
import { Modal } from '../ui/Modal';
import { useUiStore } from '../ui/uiStore';
import { type Command, getCommands } from './commands';
import { formatShortcut } from './keys';

/** Ctrl/Cmd+K opens this from anywhere; also "?" opens the shortcut sheet. */
export function useGlobalHelpKeys(): void {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const ui = useUiStore.getState();
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        ui.setPaletteOpen(!ui.paletteOpen);
        return;
      }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
        e.preventDefault();
        void saveNow().then(() => toast(t('toast.saved'), 1800));
        return;
      }
      if (e.key !== '?' || e.ctrlKey || e.metaKey || e.altKey) return;
      const el = e.target as HTMLElement | null;
      if (
        el &&
        (el.tagName === 'INPUT' ||
          el.tagName === 'TEXTAREA' ||
          el.tagName === 'SELECT' ||
          el.isContentEditable)
      )
        return;
      if (document.querySelector('[aria-modal="true"]')) return;
      e.preventDefault();
      ui.setShortcutsOpen(true);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
}

/** Searchable list of every command; arrow keys choose, Enter runs. */
export function CommandPalette() {
  const t = useT();
  const open = useUiStore((s) => s.paletteOpen);
  const setOpen = useUiStore((s) => s.setPaletteOpen);
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const list = useRef<HTMLUListElement>(null);

  const commands = useMemo(() => (open ? getCommands() : []), [open]);
  const results = useMemo(() => {
    const words = query.toLowerCase().split(/\s+/).filter(Boolean);
    return commands.filter((c) => {
      const hay = `${t(c.title)} ${t(c.group)} ${c.keywords ?? ''} ${c.id}`.toLowerCase();
      return words.every((w) => hay.includes(w));
    });
    // `t` changes only with the language, which also re-renders this component
  }, [commands, query, t]);

  useEffect(() => {
    list.current?.querySelector('[aria-selected="true"]')?.scrollIntoView?.({ block: 'nearest' });
  }, [active, results]);

  if (!open) return null;
  const close = () => {
    setOpen(false);
    setQuery('');
    setActive(0);
  };
  const run = (c: Command | undefined) => {
    if (!c) return;
    close();
    // Let the dialog close (and give focus back) before the command moves things around.
    setTimeout(c.run, 0);
  };
  const idx = Math.min(active, Math.max(results.length - 1, 0));

  return (
    <Modal
      open
      onClose={close}
      label={t('cmd.palette.title')}
      className="max-w-xl"
      placement="sheet"
    >
      <div className="flex items-center gap-2 border-b border-slate-200 px-3 py-2">
        <Search size={16} className="text-slate-500" aria-hidden />
        <input
          data-autofocus
          role="combobox"
          aria-expanded
          aria-controls="palette-list"
          aria-activedescendant={results[idx] ? `cmd-${results[idx]!.id}` : undefined}
          aria-label={t('cmd.palette.title')}
          placeholder={t('cmd.palette.placeholder')}
          className="min-w-0 flex-1 bg-transparent py-1 text-sm outline-none"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setActive(0);
          }}
          onKeyDown={(e) => {
            if (e.key === 'ArrowDown') {
              e.preventDefault();
              setActive((idx + 1) % Math.max(results.length, 1));
            } else if (e.key === 'ArrowUp') {
              e.preventDefault();
              setActive((idx - 1 + results.length) % Math.max(results.length, 1));
            } else if (e.key === 'Enter') {
              e.preventDefault();
              run(results[idx]);
            }
          }}
        />
      </div>
      <ul
        id="palette-list"
        ref={list}
        role="listbox"
        aria-label={t('cmd.palette.title')}
        className="max-h-80 overflow-auto p-1"
      >
        {results.map((c, i) => (
          <li
            key={c.id}
            id={`cmd-${c.id}`}
            role="option"
            aria-selected={i === idx}
            onMouseMove={() => setActive(i)}
            onClick={() => run(c)}
            className={`flex cursor-pointer items-center justify-between gap-3 rounded-md px-3 py-1.5 text-sm ${i === idx ? 'bg-sky-100 text-sky-800' : ''}`}
          >
            <span>
              {t(c.title)}
              <span className="ml-2 text-xs text-slate-500">{t(c.group)}</span>
            </span>
            {c.shortcut && (
              <kbd className="rounded border border-slate-300 bg-slate-50 px-1.5 py-0.5 text-xs text-slate-600">
                {formatShortcut(c.shortcut)}
              </kbd>
            )}
          </li>
        ))}
        {!results.length && (
          <li className="px-3 py-4 text-center text-sm text-slate-500">{t('cmd.palette.empty')}</li>
        )}
      </ul>
      <p className="border-t border-slate-200 px-3 py-1.5 text-xs text-slate-500">
        {t('cmd.palette.hint')}
      </p>
    </Modal>
  );
}
