import { useEffect } from 'react';
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
  useEffect(() => {
    let stop: (() => void) | undefined;
    let cancelled = false;
    void bootstrapProject().then(() => {
      if (!cancelled) stop = startAutosave(useModel);
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
