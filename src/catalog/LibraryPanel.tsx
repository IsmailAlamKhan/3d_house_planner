import { Plus, Search, Trash2, X } from 'lucide-react';
import { useEffect, useState } from 'react';
import { AddModelDialog } from '../custom/AddModelDialog';
import { assetOf } from '../custom/protocol';
import { useCustomAssets } from '../custom/store';
import { type TranslationKey, tf, useT } from '../i18n';
import {
  CATALOG,
  CATEGORIES,
  type CatalogCategory,
  type CatalogEntry,
  entriesByCategory,
  entryName,
  getEntry,
} from './index';
import { useCatalogDrag } from './dragStore';
import { cachedThumbnail, renderThumbnail } from './thumbnails';
import { formatLength } from '../ui/units';
import { toast } from './actions';
import { useModel } from '../model/store';
import { useUiStore } from '../ui/uiStore';

export const DND_MIME = 'application/x-duplex-catalog';

/** Thumbnail rendered once from the 3D builder; shows a neutral tile until it is ready (or if WebGL is missing). */
function Thumb({ entry }: { entry: CatalogEntry }) {
  const [src, setSrc] = useState<string | null | undefined>(() => cachedThumbnail(entry.catalogId));
  useEffect(() => {
    if (src !== undefined) return;
    let live = true;
    const draw = () => {
      if (live) setSrc(renderThumbnail(entry));
    };
    // An imported model is drawn once its file has been loaded.
    const h = setTimeout(() => (entry.ready ? void entry.ready.then(draw) : draw()), 0);
    return () => {
      live = false;
      clearTimeout(h);
    };
  }, [entry, src]);
  return src ? (
    <img
      src={src}
      alt=""
      width={64}
      height={64}
      draggable={false}
      className="h-16 w-16 object-contain"
    />
  ) : (
    <div className="flex h-16 w-16 items-center justify-center rounded bg-slate-100 text-lg text-slate-500">
      {entryName(entry).charAt(0)}
    </div>
  );
}

function Card({ entry }: { entry: CatalogEntry }) {
  const tt = useT();
  const units = useModel((s) => s.project.units);
  const armed = useCatalogDrag((s) => s.armedId === entry.catalogId);
  const { setDrag, setArmed } = useCatalogDrag.getState();
  const name = entryName(entry, tt);
  const { w, d } = entry.defaultSize;
  const mine = entry.catalogId.startsWith('custom:');
  const removeAsset = useCustomAssets((x) => x.remove);
  return (
    <div className="relative">
      <button
        draggable
        aria-pressed={armed}
        data-testid={`lib-${entry.catalogId}`}
        title={name}
        onDragStart={(e) => {
          e.dataTransfer.setData(DND_MIME, entry.catalogId);
          e.dataTransfer.effectAllowed = 'copy';
          setArmed(null);
          setDrag(entry.catalogId);
        }}
        onDragEnd={() => setDrag(null)}
        onClick={() => {
          setArmed(armed ? null : entry.catalogId);
          // On a phone the library is a sheet over the plan: close it so the next tap can place the item.
          if (!armed && window.innerWidth < 640) useUiStore.getState().setLeftDrawerOpen(false);
        }}
        className={`flex flex-col items-center gap-1 rounded-lg border p-2 text-center text-xs transition ${armed ? 'border-sky-500 bg-sky-50 ring-2 ring-sky-300' : 'border-slate-200 bg-white hover:border-sky-300 hover:shadow-sm'}`}
      >
        <Thumb entry={entry} />
        <span className="line-clamp-2 font-medium leading-tight text-slate-700">{name}</span>
        <span className="text-[10px] text-slate-500">
          {formatLength(w, units, 2)} ×{' '}
          {entry.placement === 'wall'
            ? formatLength(entry.defaultSize.h, units, 2)
            : formatLength(d, units, 2)}
        </span>
      </button>
      {mine && (
        <button
          type="button"
          title={tt('custom.delete')}
          aria-label={`${tt('custom.delete')} ${name}`}
          data-testid={`lib-delete-${entry.catalogId}`}
          onClick={() => {
            if (!window.confirm(tf('custom.confirmDelete', { name }))) return;
            void removeAsset(assetOf(entry.catalogId)).then(() =>
              toast(tf('custom.deleted', { name })),
            );
          }}
          className="absolute right-1 top-1 rounded-full bg-white/90 p-1 text-slate-500 shadow hover:text-red-600"
        >
          <Trash2 size={12} />
        </button>
      )}
    </div>
  );
}

/** Library of doors, windows and furniture: category tabs, search, drag or tap-to-place. */
export function LibraryPanel() {
  const tt = useT();
  const [category, setCategory] = useState<CatalogCategory>('doors');
  const [query, setQuery] = useState('');
  const [addOpen, setAddOpen] = useState(false);
  useCustomAssets((s) => s.version); // re-render when the user's own items change
  const customStatus = useCustomAssets((s) => s.status);
  const armedId = useCatalogDrag((s) => s.armedId);
  const q = query.trim().toLowerCase();
  const list = q
    ? CATALOG.filter((e) => entryName(e).toLowerCase().includes(q) || e.catalogId.includes(q))
    : category === 'custom'
      ? CATALOG.filter((e) => e.catalogId.startsWith('custom:'))
      : entriesByCategory(category);
  const armedEntry = armedId ? getEntry(armedId) : undefined;

  return (
    <div className="flex h-full flex-col gap-2">
      <label className="relative block">
        <Search size={14} className="pointer-events-none absolute left-2 top-2.5 text-slate-500" />
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={tt('lib.search')}
          aria-label={tt('lib.search')}
          className="w-full rounded-md border border-slate-300 py-1.5 pl-7 pr-2 text-sm focus:border-sky-400 focus:outline-none"
        />
      </label>
      {!q && (
        <div role="tablist" aria-label={tt('lib.categories')} className="flex flex-wrap gap-1">
          {CATEGORIES.map((c) => (
            <button
              key={c}
              role="tab"
              aria-selected={category === c}
              onClick={() => setCategory(c)}
              className={`rounded-full px-2 py-0.5 text-xs ${category === c ? 'bg-sky-700 text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'}`}
            >
              {tt(`cat.${c}` as TranslationKey)}
            </button>
          ))}
        </div>
      )}
      {armedEntry ? (
        <div
          role="status"
          className="flex items-start gap-1 rounded-md bg-sky-50 p-2 text-xs text-sky-800"
        >
          <span className="flex-1">
            {tf('msg.armed', { name: entryName(armedEntry).toLowerCase() })}
          </span>
          <button
            aria-label={tt('ai.cancel')}
            onClick={() => useCatalogDrag.getState().setArmed(null)}
            className="rounded p-0.5 hover:bg-sky-100"
          >
            <X size={14} />
          </button>
        </div>
      ) : (
        <p className="text-xs text-slate-500">{tt('lib.hint')}</p>
      )}
      {customStatus === 'unavailable' ? (
        category === 'custom' && (
          <p className="text-xs text-slate-500">{tt('custom.unavailable')}</p>
        )
      ) : (
        <button
          type="button"
          data-testid="add-custom-model"
          onClick={() => setAddOpen(true)}
          className="flex items-center justify-center gap-1 rounded-md border border-dashed border-sky-400 px-2 py-1.5 text-xs font-medium text-sky-700 hover:bg-sky-50"
        >
          <Plus size={14} /> {tt('custom.addModel')}
        </button>
      )}
      <AddModelDialog open={addOpen} onClose={() => setAddOpen(false)} />
      <div className="grid flex-1 grid-cols-2 content-start gap-2 overflow-y-auto pb-2">
        {list.map((e) => (
          <Card key={e.catalogId} entry={e} />
        ))}
        {list.length === 0 && (
          <p className="col-span-2 text-sm text-slate-500">
            {tt(!q && category === 'custom' ? 'custom.empty' : 'lib.empty')}
          </p>
        )}
      </div>
    </div>
  );
}
