import { useEffect, useState } from 'react';
import { useT } from '../i18n';
import { useModel } from '../model/store';
import { startAutosave } from '../persistence/autosave';
import { bootstrapProject } from '../persistence/bootstrap';
import { PlanCanvas } from '../plan2d/PlanCanvas';
import { SceneCanvas } from '../scene3d/SceneCanvas';
import { Drawer } from '../ui/Drawer';
import { useUiStore } from '../ui/uiStore';
import { LeftSidebar } from './LeftSidebar';
import { Toaster } from './Toaster';
import { useManipulationShortcuts } from './useManipulationShortcuts';
import { CommandPalette, useGlobalHelpKeys } from '../commands/CommandPalette';
import { ShortcutsDialog } from '../commands/ShortcutsDialog';
import { CompareDialog } from '../options/CompareDialog';
import { ExportDialog } from '../export/ExportDialog';
import { TourOverlay } from '../onboarding/TourOverlay';
import { ShellWizard } from '../wizard/ShellWizard';
import { ProjectsDialog } from './ProjectsDialog';
import { useUndoRedoShortcuts } from './useShortcuts';
import { RightSidebar } from './RightSidebar';
import { StatusBar } from './StatusBar';
import { TopBar } from './TopBar';

export function App() {
  const t = useT();
  const viewMode = useModel((s) => s.viewMode);
  const { leftDrawerOpen, rightDrawerOpen, setLeftDrawerOpen, setRightDrawerOpen } = useUiStore();
  useUndoRedoShortcuts();
  useManipulationShortcuts();
  useGlobalHelpKeys();
  const [ready, setReady] = useState(false);
  useEffect(() => {
    let stop: (() => void) | undefined;
    let cancelled = false;
    void bootstrapProject().then(() => {
      if (cancelled) return;
      stop = startAutosave(useModel);
      setReady(true);
    });
    return () => {
      cancelled = true;
      stop?.();
    };
  }, []);
  const show2d = viewMode !== '3d';
  const show3d = viewMode !== '2d';

  return (
    <div className="flex h-full flex-col">
      {!ready && (
        <div role="status" className="bg-sky-700 px-3 py-1 text-center text-xs text-white">
          {t('app.loading')}
        </div>
      )}
      <TopBar />
      <div className="flex min-h-0 flex-1">
        <aside className="hidden w-64 shrink-0 border-r border-slate-200 bg-white lg:block">
          <LeftSidebar />
        </aside>
        <main className="flex min-w-0 flex-1 flex-col sm:flex-row">
          {show2d && (
            <section className="min-h-0 min-w-0 flex-1 border-slate-300 sm:border-r">
              <PlanCanvas />
            </section>
          )}
          {show3d && (
            <section className="min-h-0 min-w-0 flex-1">
              <SceneCanvas />
            </section>
          )}
        </main>
        <aside className="hidden w-64 shrink-0 border-l border-slate-200 bg-white lg:block">
          <RightSidebar />
        </aside>
      </div>
      <StatusBar />
      <ProjectsDialog />
      <ShellWizard />
      <ExportDialog />
      <CommandPalette />
      <ShortcutsDialog />
      <TourOverlay />
      <CompareDialog />
      <Toaster />
      <Drawer
        side="left"
        open={leftDrawerOpen}
        onClose={() => setLeftDrawerOpen(false)}
        title={t('drawer.left')}
      >
        <LeftSidebar />
      </Drawer>
      <Drawer
        side="right"
        open={rightDrawerOpen}
        onClose={() => setRightDrawerOpen(false)}
        title={t('drawer.right')}
      >
        <RightSidebar />
      </Drawer>
    </div>
  );
}
