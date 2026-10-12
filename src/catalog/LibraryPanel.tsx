import { Search, X } from 'lucide-react';
import { useEffect, useState } from 'react';
import { type TranslationKey, t, tf, useT } from '../i18n';
import {
  CATALOG,
  CATEGORIES,
  type CatalogCategory,
  type CatalogEntry,
  entriesByCategory,
  getEntry,
} from './index';
import { useCatalogDrag } from './dragStore';
import { cachedThumbnail, renderThumbnail } from './thumbnails';
import { formatLength } from '../ui/units';
import { useModel } from '../model/store';

export const DND_MIME = 'application/x-duplex-catalog';

/** Thumbnail rendered once from the 3D builder; shows a neutral tile until it is ready (or if WebGL is missing). */
function Thumb({ entry }: { entry: CatalogEntry }) {
  const [src, setSrc] = useState<string | null | undefined>(() => cachedThumbnail(entry.catalogId));
  useEffect(() => {
    if (src !== undefined) return;
    const h = setTimeout(() => setSrc(renderThumbnail(entry)), 0);
    return () => clearTimeout(h);
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
    <div className="flex h-16 w-16 items-center justify-center rounded bg-slate-100 text-lg text-slate-400">
      {t(entry.nameKey as TranslationKey).charAt(0)}
    </div>
  );
}

function Card({ entry }: { entry: CatalogEntry }) {
  const tt = useT();
  const units = useModel((s) => s.project.units);
  const armed = useCatalogDrag((s) => s.armedId === entry.catalogId);
  const { setDrag, setArmed } = useCatalogDrag.getState();
  const name = tt(entry.nameKey as TranslationKey);
  const { w, d } = entry.defaultSize;
  return (
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
      onClick={() => setArmed(armed ? null : entry.catalogId)}
      className={`flex flex-col items-center gap-1 rounded-lg border p-2 text-center text-xs transition ${armed ? 'border-sky-500 bg-sky-50 ring-2 ring-sky-300' : 'border-slate-200 bg-white hover:border-sky-300 hover:shadow-sm'}`}
    >
      <Thumb entry={entry} />
      <span className="line-clamp-2 font-medium leading-tight text-slate-700">{name}</span>
      <span className="text-[10px] text-slate-400">
        {formatLength(w, units, 2)} ×{' '}
        {entry.placement === 'wall'
          ? formatLength(entry.defaultSize.h, units, 2)
          : formatLength(d, units, 2)}
      </span>
    </button>
  );
}

/** Library of doors, windows and furniture: category tabs, search, drag or tap-to-place. */
export function LibraryPanel() {
  const tt = useT();
  const [category, setCategory] = useState<CatalogCategory>('doors');
  const [query, setQuery] = useState('');
  const armedId = useCatalogDrag((s) => s.armedId);
  const q = query.trim().toLowerCase();
  const list = q
    ? CATALOG.filter(
        (e) =>
          tt(e.nameKey as TranslationKey)
            .toLowerCase()
            .includes(q) || e.catalogId.includes(q),
      )
    : entriesByCategory(category);
  const armedEntry = armedId ? getEntry(armedId) : undefined;

  return (
    <div className="flex h-full flex-col gap-2">
      <label className="relative block">
        <Search size={14} className="pointer-events-none absolute left-2 top-2.5 text-slate-400" />
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
        <div role="tablist" aria-label="Categories" className="flex flex-wrap gap-1">
          {CATEGORIES.map((c) => (
            <button
              key={c}
              role="tab"
              aria-selected={category === c}
              onClick={() => setCategory(c)}
              className={`rounded-full px-2 py-0.5 text-xs ${category === c ? 'bg-sky-600 text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'}`}
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
            {tf('msg.armed', { name: tt(armedEntry.nameKey as TranslationKey).toLowerCase() })}
          </span>
          <button
            aria-label="Cancel"
            onClick={() => useCatalogDrag.getState().setArmed(null)}
            className="rounded p-0.5 hover:bg-sky-100"
          >
            <X size={14} />
          </button>
        </div>
      ) : (
        <p className="text-xs text-slate-500">{tt('lib.hint')}</p>
      )}
      <div className="grid flex-1 grid-cols-2 content-start gap-2 overflow-y-auto pb-2">
        {list.map((e) => (
          <Card key={e.catalogId} entry={e} />
        ))}
        {list.length === 0 && (
          <p className="col-span-2 text-sm text-slate-500">{tt('lib.empty')}</p>
        )}
      </div>
    </div>
  );
}
