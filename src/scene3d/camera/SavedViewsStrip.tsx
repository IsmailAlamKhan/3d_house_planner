import { Pencil, X } from 'lucide-react';
import { useT } from '../../i18n';
import { deleteView, renameView } from '../../model/ops';
import { useModel } from '../../model/store';
import { useCamera } from './cameraStore';
import { defaultSection } from './section';

/** Thumbnails of the views saved in the project; click one to fly there. */
export function SavedViewsStrip({ readOnly = false }: { readOnly?: boolean }) {
  const t = useT();
  const views = useModel((s) => s.project.views);
  const setMode = useCamera((s) => s.setMode);
  const flyTo = useCamera((s) => s.flyTo);
  if (!views.length) return null;
  return (
    <ul
      aria-label={t('cam.views')}
      className="pointer-events-auto absolute bottom-2 left-1/2 flex max-w-[60%] -translate-x-1/2 gap-2 overflow-x-auto rounded-lg border border-slate-200 bg-white/95 p-1.5 shadow"
    >
      {views.map((v) => (
        <li key={v.id} className="group relative w-24 shrink-0" data-testid="saved-view">
          <button
            className="block w-full text-left"
            title={v.name}
            onClick={() => {
              setMode(v.mode === 'walk' ? 'orbit' : v.mode);
              useCamera
                .getState()
                .setSection(v.section ? structuredClone(v.section) : defaultSection());
              flyTo({ position: v.position, target: v.target, zoom: v.zoom });
            }}
          >
            {v.thumbnail ? (
              <img src={v.thumbnail} alt="" className="h-14 w-24 rounded object-cover" />
            ) : (
              <div className="h-14 w-24 rounded bg-slate-200" />
            )}
            <span className="block truncate text-[11px] text-slate-700">{v.name}</span>
          </button>
          {!readOnly && (
            <div className="absolute right-0.5 top-0.5 flex gap-0.5 opacity-0 focus-within:opacity-100 group-hover:opacity-100">
              <button
                aria-label={`${t('cam.viewRename')}: ${v.name}`}
                className="rounded bg-white/90 p-0.5 text-slate-600 shadow hover:text-sky-700"
                onClick={() => {
                  const name = window.prompt(t('cam.viewName'), v.name);
                  if (name?.trim()) useModel.getState().apply((p) => renameView(p, v.id, name));
                }}
              >
                <Pencil size={12} />
              </button>
              <button
                aria-label={`${t('cam.viewDelete')}: ${v.name}`}
                className="rounded bg-white/90 p-0.5 text-slate-600 shadow hover:text-red-600"
                onClick={() => useModel.getState().apply((p) => deleteView(p, v.id))}
              >
                <X size={12} />
              </button>
            </div>
          )}
        </li>
      ))}
    </ul>
  );
}
