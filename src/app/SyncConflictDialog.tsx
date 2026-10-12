import { useT } from '../i18n';
import { useModel } from '../model/store';
import { Modal } from '../ui/Modal';
import { syncClient, useSync } from '../persistence/syncStore';

/** Shown when another device saved the same project first: reload theirs, keep yours as a copy, or overwrite. */
export function SyncConflictDialog() {
  const t = useT();
  const conflict = useSync((s) => s.conflict);
  if (!conflict) return null;
  const done = () => useSync.getState().setConflict(null);
  const mine = () => useModel.getState().project;

  const reload = async () => {
    const c = syncClient();
    if (c) {
      const { saveProject } = await import('../persistence/repo');
      const { setMeta } = await import('../persistence/sync');
      await saveProject(conflict.project);
      await setMeta(conflict.project.id, { revision: conflict.revision, dirty: false });
    }
    useModel.getState().loadProject(conflict.project);
    useSync.getState().setStatus('synced');
    done();
  };
  const copy = async () => {
    const c = syncClient();
    if (!c) return done();
    const made = await c.saveAsCopy(mine(), {
      revision: conflict.revision,
      project: conflict.project,
    });
    useModel.getState().loadProject(made);
    useSync.getState().setStatus('synced');
    done();
  };
  const overwrite = async () => {
    const c = syncClient();
    if (!c) return done();
    const r = await c.overwrite(mine(), conflict.revision);
    useSync.getState().setStatus(r.kind === 'ok' ? 'synced' : 'offline');
    done();
  };
  const btn =
    'w-full rounded-md border border-slate-300 px-3 py-2 text-left text-sm hover:bg-slate-100';
  return (
    <Modal open onClose={() => undefined} label={t('sync.conflictTitle')} className="max-w-md">
      <div className="space-y-3 p-4">
        <h2 className="font-semibold">{t('sync.conflictTitle')}</h2>
        <p className="text-sm text-slate-600">{t('sync.conflictBody')}</p>
        <button data-autofocus className={btn} onClick={() => void reload()}>
          <b>{t('sync.reload')}</b>
          <span className="block text-xs text-slate-500">{t('sync.reloadHint')}</span>
        </button>
        <button className={btn} onClick={() => void copy()}>
          <b>{t('sync.copy')}</b>
          <span className="block text-xs text-slate-500">{t('sync.copyHint')}</span>
        </button>
        <button className={btn} onClick={() => void overwrite()}>
          <b>{t('sync.overwrite')}</b>
          <span className="block text-xs text-slate-500">{t('sync.overwriteHint')}</span>
        </button>
      </div>
    </Modal>
  );
}
