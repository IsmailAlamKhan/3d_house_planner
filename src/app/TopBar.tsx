import { Command, Download, FolderOpen, PanelLeft, PanelRight, Redo2, Undo2 } from 'lucide-react';
import { withShortcut } from '../commands/keys';
import { HelpMenu } from './HelpMenu';
import { SettingsMenu } from './SettingsMenu';
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
    <header className="flex flex-wrap items-center gap-x-2 gap-y-1 border-b border-slate-200 bg-white px-3 py-2">
      <button
        className={`${iconBtn} order-1 lg:hidden`}
        aria-label={t('drawer.left')}
        title={t('drawer.left')}
        onClick={() => setLeftDrawerOpen(true)}
      >
        <PanelLeft size={18} />
      </button>
      <h1 className="order-2 hidden text-sm font-semibold text-slate-500 sm:block">
        {t('app.title')}
      </h1>
      <div className="order-3 flex min-w-0 flex-1 sm:flex-none">
        <ProjectName />
      </div>
      <button
        className={`${iconBtn} order-4`}
        onClick={() => setProjectsOpen(true)}
        aria-label={t('projects.open')}
        title={t('projects.open')}
        data-tour="projects"
      >
        <FolderOpen size={18} />
        <span className="hidden md:inline">{t('projects.open')}</span>
      </button>
      <button
        className={`${iconBtn} order-5 sm:order-9`}
        onClick={() => useUiStore.getState().setExportOpen(true)}
        aria-label={t('topbar.export')}
        title={t('topbar.export')}
        data-tour="export"
      >
        <Download size={18} />
        <span className="hidden sm:inline">{t('topbar.export')}</span>
      </button>
      <button
        className={`${iconBtn} order-6 sm:order-[12] lg:hidden`}
        aria-label={t('drawer.right')}
        title={t('drawer.right')}
        onClick={() => setRightDrawerOpen(true)}
      >
        <PanelRight size={18} />
      </button>
      <div className="order-7 flex flex-1 items-center gap-1 sm:ml-auto sm:flex-none">
        <button
          className={iconBtn}
          disabled={!canUndo}
          onClick={undo}
          aria-label={t('topbar.undo')}
          title={withShortcut(t('topbar.undo'), 'Mod+Z')}
        >
          <Undo2 size={18} />
        </button>
        <button
          className={iconBtn}
          disabled={!canRedo}
          onClick={redo}
          aria-label={t('topbar.redo')}
          title={withShortcut(t('topbar.redo'), 'Mod+Shift+Z')}
        >
          <Redo2 size={18} />
        </button>
        <div
          role="group"
          aria-label={t('view.group')}
          className="mx-1 flex flex-1 rounded-md bg-slate-100 p-0.5 sm:mx-2 sm:flex-none"
        >
          {modes.map((m) => (
            <button
              key={m.id}
              onClick={() => setViewMode(m.id)}
              aria-pressed={viewMode === m.id}
              className={`flex-1 rounded px-3 py-1.5 text-sm sm:flex-none sm:py-1 ${
                viewMode === m.id ? 'bg-white font-semibold shadow-sm' : 'text-slate-600'
              }`}
            >
              {t(m.label)}
            </button>
          ))}
        </div>
      </div>
      <div className="order-8 flex items-center gap-1 sm:order-10">
        <button
          className={iconBtn}
          aria-label={t('cmd.palette.title')}
          title={withShortcut(t('cmd.palette.title'), 'Mod+K')}
          onClick={() => useUiStore.getState().setPaletteOpen(true)}
        >
          <Command size={18} />
        </button>
        <HelpMenu />
        <SettingsMenu />
      </div>
    </header>
  );
}
