import { Download, FolderOpen, PanelLeft, PanelRight, Redo2, Undo2 } from 'lucide-react';
import { useT } from '../i18n';
import { redo, undo, useHistoryState, useModel, type ViewMode } from '../model/store';
import { useUiStore } from '../ui/uiStore';

const modes: { id: ViewMode; label: 'view.2d' | 'view.3d' | 'view.split' }[] = [
  { id: '2d', label: 'view.2d' },
  { id: '3d', label: 'view.3d' },
  { id: 'split', label: 'view.split' },
];

const iconBtn =
  'inline-flex items-center gap-1 rounded-md px-2 py-1.5 text-sm hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-40';

function ProjectName() {
  const t = useT();
  const name = useModel((s) => s.project.name);
  const apply = useModel((s) => s.apply);
  return (
    <input
      // Re-mount when the stored name changes (undo, open project) so the field shows it.
      key={name}
      aria-label={t('project.name')}
      defaultValue={name}
      onBlur={(e) => {
        const next = e.currentTarget.value.trim();
        if (!next) e.currentTarget.value = name;
        else if (next !== name) apply((p) => void (p.name = next));
      }}
      onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
      className="min-w-0 flex-1 rounded-md border border-transparent px-2 py-1 text-sm font-medium hover:border-slate-200 focus:border-sky-400 focus:outline-none sm:max-w-xs sm:flex-none"
    />
  );
}

export function TopBar() {
  const t = useT();
  const viewMode = useModel((s) => s.viewMode);
  const setViewMode = useModel((s) => s.setViewMode);
  const { canUndo, canRedo } = useHistoryState();
  const { setLeftDrawerOpen, setRightDrawerOpen, setProjectsOpen } = useUiStore();
  return (
    <header className="flex items-center gap-2 border-b border-slate-200 bg-white px-3 py-2">
      <button
        className={`${iconBtn} lg:hidden`}
        aria-label={t('drawer.left')}
        onClick={() => setLeftDrawerOpen(true)}
      >
        <PanelLeft size={18} />
      </button>
      <h1 className="hidden text-sm font-semibold text-slate-500 sm:block">{t('app.title')}</h1>
      <ProjectName />
      <button
        className={iconBtn}
        onClick={() => setProjectsOpen(true)}
        aria-label={t('projects.open')}
      >
        <FolderOpen size={18} />
        <span className="hidden md:inline">{t('projects.open')}</span>
      </button>
      <div className="ml-auto flex items-center gap-1">
        <button
          className={iconBtn}
          disabled={!canUndo}
          onClick={undo}
          aria-label={t('topbar.undo')}
        >
          <Undo2 size={18} />
        </button>
        <button
          className={iconBtn}
          disabled={!canRedo}
          onClick={redo}
          aria-label={t('topbar.redo')}
        >
          <Redo2 size={18} />
        </button>
        <div role="group" aria-label="View" className="mx-2 flex rounded-md bg-slate-100 p-0.5">
          {modes.map((m) => (
            <button
              key={m.id}
              onClick={() => setViewMode(m.id)}
              aria-pressed={viewMode === m.id}
              className={`rounded px-3 py-1 text-sm ${
                viewMode === m.id ? 'bg-white font-semibold shadow-sm' : 'text-slate-600'
              }`}
            >
              {t(m.label)}
            </button>
          ))}
        </div>
        <button className={iconBtn} disabled>
          <Download size={18} />
          <span className="hidden sm:inline">{t('topbar.export')}</span>
        </button>
        <button
          className={`${iconBtn} lg:hidden`}
          aria-label={t('drawer.right')}
          onClick={() => setRightDrawerOpen(true)}
        >
          <PanelRight size={18} />
        </button>
      </div>
    </header>
  );
}
