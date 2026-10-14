import { Suspense, lazy, useEffect, useState } from 'react';
import { useT } from '../i18n';
import { useModel } from '../model/store';
import { startAutosave } from '../persistence/autosave';
import { pushOpenProject, startSync } from '../persistence/syncStore';
import { SyncConflictDialog } from './SyncConflictDialog';
import { useCustomAssets } from '../custom/store';
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
import { PwaBanner } from '../pwa/PwaBanner';
import { TourOverlay } from '../onboarding/TourOverlay';
import { ProjectsDialog } from './ProjectsDialog';
import { useUndoRedoShortcuts } from './useShortcuts';
import { RightSidebar } from './RightSidebar';
import { StatusBar } from './StatusBar';
import { RecreateDialog } from '../ai/vision/RecreateDialog';
import { CompareView } from '../underlay/CompareView';
import { UnderlaySetupDialog } from '../underlay/SetupDialog';
import { TopBar } from './TopBar';

// Heavy, rarely-needed screens load on demand so the first paint stays fast.
const ExportDialog = lazy(() =>
  import('../export/ExportDialog').then((m) => ({ default: m.ExportDialog })),
);
const CompareDialog = lazy(() =>
  import('../options/CompareDialog').then((m) => ({ default: m.CompareDialog })),
);
const ShellWizard = lazy(() =>
  import('../wizard/ShellWizard').then((m) => ({ default: m.ShellWizard })),
);

export function App() {
  const t = useT();
  const viewMode = useModel((s) => s.viewMode);
  const wizardOpen = useUiStore((s) => s.wizardOpen);
  const exportOpen = useUiStore((s) => s.exportOpen);
  const compareOpen = useUiStore((s) => s.compareOpen);
  const { leftDrawerOpen, rightDrawerOpen, setLeftDrawerOpen, setRightDrawerOpen } = useUiStore();
  useUndoRedoShortcuts();
  useManipulationShortcuts();
  useGlobalHelpKeys();
  const [ready, setReady] = useState(false);
  useEffect(() => {
    let stop: (() => void) | undefined;
    let stopSync: Promise<() => void> | undefined;
    let cancelled = false;
    // The user's own models and textures (kept on the app server) join the library while the project loads.
    void useCustomAssets.getState().refresh();
    void bootstrapProject().then(() => {
      if (cancelled) return;
      stop = startAutosave(useModel, undefined, 1000, pushOpenProject);
      stopSync = startSync().then((s) => s);
      setReady(true);
    });
    return () => {
      cancelled = true;
      stop?.();
      void stopSync?.then((s) => s());
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
            <section className="relative min-h-0 min-w-0 flex-1">
              <SceneCanvas />
              <CompareView />
            </section>
          )}
        </main>
        <aside className="hidden w-64 shrink-0 border-l border-slate-200 bg-white lg:block">
          <RightSidebar />
        </aside>
      </div>
      <StatusBar />
      <UnderlaySetupDialog />
      <RecreateDialog />
      <ProjectsDialog />
      <Suspense fallback={null}>
        {wizardOpen && <ShellWizard />}
        {exportOpen && <ExportDialog />}
        {compareOpen && <CompareDialog />}
      </Suspense>
      <CommandPalette />
      <ShortcutsDialog />
      <TourOverlay />
      <PwaBanner />
      <SyncConflictDialog />
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
