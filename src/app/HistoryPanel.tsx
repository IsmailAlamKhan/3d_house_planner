import { History } from 'lucide-react';
import { useEffect, useState } from 'react';
import { toast } from '../catalog/actions';
import { fmtNum, localeTag, t, tf, useT } from '../i18n';
import { useModel } from '../model/store';
import {
  type SnapshotInfo,
  listSnapshots,
  loadSnapshot,
  saveSnapshot,
} from '../persistence/history';

const currentTime = () => Date.now();

/** The last 20 autosaved versions of the open project, with Restore. */
export function HistoryPanel() {
  const tt = useT();
  const id = useModel((s) => s.project.id);
  const [list, setList] = useState<SnapshotInfo[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      // Make sure the very latest state is among the versions before listing.
      await saveSnapshot(useModel.getState().project);
      const items = await listSnapshots(id);
      if (!cancelled) setList(items);
    })();
    return () => {
      cancelled = true;
    };
  }, [id]);

  const restore = async (s: SnapshotInfo) => {
    const project = await loadSnapshot(id, s.index);
    if (!project) return;
    // Keep the work being replaced as a version, so Restore itself can be undone by restoring that one.
    await saveSnapshot(useModel.getState().project, undefined, currentTime(), true);
    useModel.getState().loadProject(project);
    toast(tf('history.restored', { time: new Date(s.savedAt).toLocaleTimeString(localeTag()) }));
    setList(await listSnapshots(id));
  };

  return (
    <section aria-label={tt('history.title')} className="border-t border-slate-200 px-4 py-3">
      <h3 className="flex items-center gap-1 text-sm font-semibold">
        <History size={14} /> {tt('history.title')}
      </h3>
      <p className="mb-2 text-xs text-slate-500">{tt('history.hint')}</p>
      {list && list.length === 0 && <p className="text-xs text-slate-500">{tt('history.empty')}</p>}
      <ul className="max-h-40 space-y-1 overflow-auto">
        {(list ?? []).map((s, n) => (
          <li
            key={s.savedAt}
            data-testid="snapshot-row"
            className="flex items-center gap-2 text-xs"
          >
            <span className="flex-1">
              <b>{new Date(s.savedAt).toLocaleString(localeTag())}</b>
              <span className="ml-2 text-slate-500">
                {t('history.summary')
                  .replace('{rooms}', fmtNum(s.rooms, 0))
                  .replace('{walls}', fmtNum(s.walls, 0))
                  .replace('{items}', fmtNum(s.items, 0))}
              </span>
            </span>
            <button
              disabled={n === 0}
              className="rounded-md border border-slate-300 px-2 py-0.5 hover:bg-slate-100 disabled:opacity-40"
              onClick={() => void restore(s)}
            >
              {tt('history.restore')}
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}
