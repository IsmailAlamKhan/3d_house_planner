import { Copy, Download, FilePlus, Pencil, Trash2, Upload, X } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useT } from '../i18n';
import { downloadTextFile, exportProjectJson, importProjectJson } from '../model/io';
import { useModel } from '../model/store';
import {
  cloneProject,
  deleteProject,
  duplicateStoredProject,
  listProjects,
  loadStoredProject,
  renameStoredProject,
  saveProject,
  type ProjectSummary,
} from '../persistence/repo';
import { useUiStore } from '../ui/uiStore';

const btn = 'inline-flex items-center gap-1 rounded-md px-2 py-1 text-sm hover:bg-slate-100';

export function ProjectsDialog() {
  const t = useT();
  const open = useUiStore((s) => s.projectsOpen);
  const setOpen = useUiStore((s) => s.setProjectsOpen);
  const current = useModel((s) => s.project);
  const [list, setList] = useState<ProjectSummary[]>([]);
  const [error, setError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const refresh = useCallback(async () => {
    // Make sure the open project is in the list before reading it back.
    await saveProject(useModel.getState().project);
    setList(await listProjects());
  }, []);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    void (async () => {
      await saveProject(useModel.getState().project);
      const items = await listProjects();
      if (!cancelled) setList(items);
    })();
    return () => {
      cancelled = true;
    };
  }, [open]);

  if (!open) return null;

  const openProject = async (id: string) => {
    if (id === current.id) return setOpen(false);
    await saveProject(useModel.getState().project);
    const p = await loadStoredProject(id);
    if (p) useModel.getState().loadProject(p);
    setOpen(false);
  };

  const create = async () => {
    setOpen(false);
    useUiStore.getState().setWizardOpen(true);
  };

  const importFile = async (file: File) => {
    try {
      setError(null);
      let p = importProjectJson(await file.text());
      if ((await listProjects()).some((x) => x.id === p.id)) p = cloneProject(p, p.name);
      await saveProject(useModel.getState().project);
      await saveProject(p);
      useModel.getState().loadProject(p);
      setOpen(false);
    } catch (e) {
      setError(`${t('projects.importFailed')}: ${e instanceof Error ? e.message : String(e)}`);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      role="dialog"
      aria-label={t('projects.title')}
    >
      <button
        aria-label={t('drawer.close')}
        className="absolute inset-0 bg-slate-900/40"
        onClick={() => setOpen(false)}
      />
      <div className="relative flex max-h-full w-full max-w-lg flex-col rounded-lg bg-white shadow-xl">
        <div className="flex items-center border-b border-slate-200 px-4 py-3">
          <h2 className="flex-1 font-semibold">{t('projects.title')}</h2>
          <button aria-label={t('drawer.close')} className={btn} onClick={() => setOpen(false)}>
            <X size={16} />
          </button>
        </div>
        <div className="flex flex-wrap gap-1 border-b border-slate-200 px-3 py-2">
          <button className={btn} onClick={create}>
            <FilePlus size={16} /> {t('projects.new')}
          </button>
          <button className={btn} onClick={() => fileRef.current?.click()}>
            <Upload size={16} /> {t('projects.import')}
          </button>
          <button
            className={btn}
            onClick={() =>
              downloadTextFile(
                `${current.name.replace(/[^\w-]+/g, '_') || 'project'}.json`,
                exportProjectJson(current),
              )
            }
          >
            <Download size={16} /> {t('projects.exportCurrent')}
          </button>
          <input
            ref={fileRef}
            type="file"
            accept="application/json,.json"
            hidden
            data-testid="import-input"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) void importFile(f);
              e.target.value = '';
            }}
          />
        </div>
        {error && (
          <p role="alert" className="px-4 py-2 text-sm text-red-600">
            {error}
          </p>
        )}
        <ul className="overflow-y-auto p-2">
          {list.length === 0 && (
            <li className="p-3 text-sm text-slate-500">{t('projects.empty')}</li>
          )}
          {list.map((p) => (
            <li
              key={p.id}
              className="flex items-center gap-1 rounded-md px-2 py-1.5 hover:bg-slate-50"
            >
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-medium">{p.name}</div>
                <div className="text-xs text-slate-500">
                  {new Date(p.updatedAt).toLocaleString()}
                  {p.id === current.id && ` · ${t('projects.current')}`}
                </div>
              </div>
              <button className={btn} onClick={() => openProject(p.id)}>
                {t('projects.openBtn')}
              </button>
              <button
                className={btn}
                aria-label={`${t('projects.duplicate')} ${p.name}`}
                onClick={async () => {
                  await duplicateStoredProject(p.id);
                  await refresh();
                }}
              >
                <Copy size={14} />
              </button>
              <button
                className={btn}
                aria-label={`${t('projects.rename')} ${p.name}`}
                onClick={async () => {
                  const name = window.prompt(t('projects.rename'), p.name)?.trim();
                  if (!name) return;
                  if (p.id === current.id) useModel.getState().apply((d) => void (d.name = name));
                  else await renameStoredProject(p.id, name);
                  await refresh();
                }}
              >
                <Pencil size={14} />
              </button>
              <button
                className={`${btn} text-red-600`}
                aria-label={`${t('projects.delete')} ${p.name}`}
                disabled={p.id === current.id}
                onClick={async () => {
                  if (!window.confirm(t('projects.confirmDelete'))) return;
                  await deleteProject(p.id);
                  await refresh();
                }}
              >
                <Trash2 size={14} />
              </button>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
