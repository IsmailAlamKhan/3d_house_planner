import { toast } from '../catalog/actions';
import { t, type TranslationKey } from '../i18n';
import { saveNow } from '../persistence/autosave';
import { redo, undo, useModel } from '../model/store';
import type { Tool } from '../model/types';
import { usePrefs } from '../prefs/prefsStore';
import { useCamera } from '../scene3d/camera/cameraStore';
import { type Preset, presetPose } from '../scene3d/camera/views';
import { useSceneStore } from '../scene3d/sceneStore';
import { useUiStore, type LeftTab } from '../ui/uiStore';
import { duplicateSelected } from '../catalog/actions';
import { deleteSelected } from '../plan2d/interaction';
import { startTour } from '../onboarding/tourStore';

export type CommandGroup =
  | 'cmd.group.tools'
  | 'cmd.group.view'
  | 'cmd.group.camera'
  | 'cmd.group.panels'
  | 'cmd.group.project'
  | 'cmd.group.settings'
  | 'cmd.group.help';

export interface Command {
  id: string;
  title: TranslationKey;
  group: CommandGroup;
  /** Shown next to the command (e.g. "Mod+K"). */
  shortcut?: string;
  /** Extra search words (not shown). */
  keywords?: string;
  run: () => void;
}

const tool = (id: Tool, title: TranslationKey, shortcut?: string): Command => ({
  id: `tool.${id}`,
  title,
  group: 'cmd.group.tools',
  shortcut,
  run: () => {
    const m = useModel.getState();
    // Plan tools need the plan: leave a 3D-only layout first.
    if (m.viewMode === '3d') m.setViewMode('split');
    m.setTool(id);
  },
});

const view3d = (run: () => void) => () => {
  const m = useModel.getState();
  if (m.viewMode === '2d') m.setViewMode('split');
  run();
};

const panel = (tab: LeftTab, title: TranslationKey): Command => ({
  id: `panel.${tab}`,
  title,
  group: 'cmd.group.panels',
  run: () => {
    const ui = useUiStore.getState();
    ui.setLeftTab(tab);
    ui.setLeftDrawerOpen(true); // on a phone the panels are in a sheet
  },
});

const preset = (p: Preset, title: TranslationKey): Command => ({
  id: `camera.${p}`,
  title,
  group: 'cmd.group.camera',
  run: view3d(() => {
    const cam = useCamera.getState();
    if (cam.mode !== 'orbit') cam.setMode('orbit');
    cam.flyTo(presetPose(useModel.getState().project, p));
  }),
});

/** Everything the command palette (Ctrl/Cmd+K) can do. */
export function getCommands(): Command[] {
  return [
    tool('select', 'cmd.select', 'V'),
    tool('wall', 'cmd.wall', 'W'),
    tool('room', 'cmd.room', 'R'),
    tool('measure', 'cmd.measure', 'M'),
    tool('eyedropper', 'cmd.eyedropper', 'I'),
    tool('note', 'cmd.note', 'N'),
    {
      id: 'edit.undo',
      title: 'topbar.undo',
      group: 'cmd.group.tools',
      shortcut: 'Mod+Z',
      run: undo,
    },
    {
      id: 'edit.redo',
      title: 'topbar.redo',
      group: 'cmd.group.tools',
      shortcut: 'Mod+Shift+Z',
      run: redo,
    },
    {
      id: 'edit.duplicate',
      title: 'cmd.duplicate',
      group: 'cmd.group.tools',
      shortcut: 'Mod+D',
      run: duplicateSelected,
    },
    {
      id: 'edit.delete',
      title: 'cmd.delete',
      group: 'cmd.group.tools',
      shortcut: 'Del',
      run: deleteSelected,
    },

    {
      id: 'view.2d',
      title: 'cmd.view2d',
      group: 'cmd.group.view',
      run: () => useModel.getState().setViewMode('2d'),
    },
    {
      id: 'view.3d',
      title: 'cmd.view3d',
      group: 'cmd.group.view',
      run: () => useModel.getState().setViewMode('3d'),
    },
    {
      id: 'view.split',
      title: 'cmd.viewSplit',
      group: 'cmd.group.view',
      run: () => useModel.getState().setViewMode('split'),
    },
    {
      id: 'view.compare',
      title: 'cmd.compare',
      group: 'cmd.group.view',
      keywords: 'options compare side by side',
      run: () => useUiStore.getState().setCompareOpen(true),
    },

    {
      id: 'camera.orbit',
      title: 'cam.orbit',
      group: 'cmd.group.camera',
      run: view3d(() => useCamera.getState().setMode('orbit')),
    },
    {
      id: 'camera.walk',
      title: 'cam.walk',
      group: 'cmd.group.camera',
      keywords: 'walkthrough first person',
      run: view3d(() => useCamera.getState().setMode('walk')),
    },
    {
      id: 'camera.top',
      title: 'cam.top',
      group: 'cmd.group.camera',
      keywords: 'plan from above',
      run: view3d(() => useCamera.getState().setMode('top')),
    },
    preset('front', 'cam.front'),
    preset('back', 'cam.back'),
    preset('left', 'cam.left'),
    preset('right', 'cam.right'),
    preset('iso', 'cam.iso'),
    {
      id: 'camera.reset',
      title: 'view3d.resetCamera',
      group: 'cmd.group.camera',
      run: view3d(() => useSceneStore.getState().resetCamera()),
    },
    {
      id: 'camera.focus',
      title: 'cmd.focus',
      group: 'cmd.group.camera',
      shortcut: 'F',
      run: view3d(() => useCamera.getState().requestFocus()),
    },
    {
      id: 'camera.xray',
      title: 'cam.xray',
      group: 'cmd.group.camera',
      run: view3d(() => useCamera.getState().setXray(!useCamera.getState().xray)),
    },

    panel('library', 'sidebar.library'),
    panel('levels', 'sidebar.levels'),
    panel('ai', 'sidebar.ai'),
    panel('checks', 'sidebar.checks'),
    panel('notes', 'sidebar.notes'),

    {
      id: 'project.save',
      title: 'cmd.save',
      group: 'cmd.group.project',
      shortcut: 'Mod+S',
      run: () => void saveNow().then(() => toast(t('toast.saved'), 1800)),
    },
    {
      id: 'project.new',
      title: 'projects.new',
      group: 'cmd.group.project',
      run: () => useUiStore.getState().setWizardOpen(true),
    },
    {
      id: 'project.open',
      title: 'projects.open',
      group: 'cmd.group.project',
      run: () => useUiStore.getState().setProjectsOpen(true),
    },
    {
      id: 'project.export',
      title: 'export.title',
      group: 'cmd.group.project',
      keywords: 'pdf image glb dxf svg download share costs',
      run: () => useUiStore.getState().setExportOpen(true),
    },

    {
      id: 'settings.en',
      title: 'cmd.langEn',
      group: 'cmd.group.settings',
      run: () => usePrefs.getState().set({ language: 'en' }),
    },
    {
      id: 'settings.bn',
      title: 'cmd.langBn',
      group: 'cmd.group.settings',
      keywords: 'bangla bengali',
      run: () => usePrefs.getState().set({ language: 'bn' }),
    },
    {
      id: 'settings.light',
      title: 'cmd.themeLight',
      group: 'cmd.group.settings',
      run: () => usePrefs.getState().set({ theme: 'light' }),
    },
    {
      id: 'settings.dark',
      title: 'cmd.themeDark',
      group: 'cmd.group.settings',
      run: () => usePrefs.getState().set({ theme: 'dark' }),
    },
    {
      id: 'settings.system',
      title: 'cmd.themeSystem',
      group: 'cmd.group.settings',
      run: () => usePrefs.getState().set({ theme: 'system' }),
    },
    {
      id: 'settings.motion',
      title: 'cmd.motion',
      group: 'cmd.group.settings',
      run: () => {
        const p = usePrefs.getState();
        p.set({ motion: p.motion === 'reduce' ? 'full' : 'reduce' });
      },
    },

    { id: 'help.tour', title: 'help.tour', group: 'cmd.group.help', run: startTour },
    {
      id: 'help.shortcuts',
      title: 'kb.sheet',
      group: 'cmd.group.help',
      shortcut: '?',
      run: () => useUiStore.getState().setShortcutsOpen(true),
    },
    {
      id: 'help.palette',
      title: 'kb.palette',
      group: 'cmd.group.help',
      shortcut: 'Mod+K',
      run: () => useUiStore.getState().setPaletteOpen(true),
    },
  ];
}
