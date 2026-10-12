import { Copy, GitCompare, Pencil, Trash2 } from 'lucide-react';
import { useT } from '../i18n';
import { toast } from '../catalog/actions';
import { type OptionMeta } from '../model/types';
import {
  allDesigns,
  deleteDesign,
  duplicateDesign,
  renameDesign,
  switchDesign,
} from '../model/ops';
import { useModel } from '../model/store';
import { useUiStore } from '../ui/uiStore';

type T = ReturnType<typeof useT>;

/** "Main design", "Option A" or the name the user gave. */
export const designTitle = (d: OptionMeta, t: T): string =>
  d.name ??
  (d.letter === null ? t('options.main') : t('options.copy').replace('{letter}', d.letter));

const small =
  'inline-flex items-center gap-1 rounded-md border border-slate-300 px-2 py-1 text-xs hover:bg-slate-100 disabled:opacity-40';

/** Design options ("Option A / B / C") of the current project: save a copy, switch, rename, delete, compare. */
export function OptionsPanel() {
  const t = useT();
  const live = useModel((s) => s.project);
  const designs = allDesigns(live);
  const apply = useModel.getState().apply;
  return (
    <section
      aria-label={t('options.title')}
      className="space-y-2 border-t border-slate-200 pt-3 text-slate-700"
    >
      <h2 className="text-sm font-semibold">{t('options.title')}</h2>
      <ul className="space-y-1">
        {designs.map((d) => (
          <li
            key={d.id}
            data-testid="design-row"
            data-current={d.current}
            className={`flex items-center gap-1 rounded-md border px-2 py-1.5 text-sm ${d.current ? 'border-sky-400 bg-sky-50' : 'border-slate-200'}`}
          >
            <span className="min-w-0 flex-1 truncate font-medium">{designTitle(d, t)}</span>
            {d.current ? (
              <span className="text-xs text-sky-700">{t('options.showingNow')}</span>
            ) : (
              <button
                className={small}
                onClick={() => {
                  apply((p) => switchDesign(p, d.id));
                  toast(t('options.switched').replace('{name}', designTitle(d, t)));
                }}
              >
                {t('options.switch')}
              </button>
            )}
            <button
              className="rounded p-1 text-slate-500 hover:bg-slate-100"
              aria-label={`${t('options.rename')}: ${designTitle(d, t)}`}
              title={t('options.rename')}
              onClick={() => {
                const name = window.prompt(t('options.rename'), designTitle(d, t));
                if (name !== null) apply((p) => renameDesign(p, d.id, name));
              }}
            >
              <Pencil size={13} />
            </button>
            {!d.current && (
              <button
                className="rounded p-1 text-slate-500 hover:bg-slate-100 hover:text-red-700"
                aria-label={`${t('options.delete')}: ${designTitle(d, t)}`}
                title={t('options.delete')}
                onClick={() => {
                  if (window.confirm(t('options.confirmDelete')))
                    apply((p) => deleteDesign(p, d.id));
                }}
              >
                <Trash2 size={13} />
              </button>
            )}
          </li>
        ))}
      </ul>
      {designs.length < 2 && <p className="text-xs text-slate-500">{t('options.none')}</p>}
      <div className="flex flex-wrap gap-1">
        <button
          className={small}
          onClick={() => {
            apply((p) => duplicateDesign(p));
            const now = useModel.getState().project.currentOption;
            toast(t('options.saved').replace('{name}', designTitle(now, t)));
          }}
        >
          <Copy size={12} /> {t('options.save')}
        </button>
        <button
          className={small}
          disabled={designs.length < 2}
          onClick={() => useUiStore.getState().setCompareOpen(true)}
        >
          <GitCompare size={12} /> {t('options.compare')}
        </button>
      </div>
    </section>
  );
}
