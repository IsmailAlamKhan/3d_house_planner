import type { TranslationKey } from '../i18n';

export interface ShortcutGroup {
  title: TranslationKey;
  items: { keys: string; label: TranslationKey }[];
}

/** Every keyboard shortcut in the app, as shown in the "?" sheet. Keep in step with the handlers. */
export const SHORTCUTS: ShortcutGroup[] = [
  {
    title: 'kb.general',
    items: [
      { keys: 'Mod+K', label: 'kb.palette' },
      { keys: '?', label: 'kb.sheet' },
      { keys: 'Mod+S', label: 'cmd.save' },
      { keys: 'Mod+Z', label: 'topbar.undo' },
      { keys: 'Mod+Shift+Z', label: 'topbar.redo' },
      { keys: 'Esc', label: 'kb.escape' },
    ],
  },
  {
    title: 'kb.plan',
    items: [
      { keys: 'V', label: 'cmd.select' },
      { keys: 'W', label: 'cmd.wall' },
      { keys: 'R', label: 'cmd.room' },
      { keys: 'M', label: 'cmd.measure' },
      { keys: 'I', label: 'cmd.eyedropper' },
      { keys: 'N', label: 'cmd.note' },
      { keys: 'Space + drag', label: 'kb.pan' },
      { keys: 'Del', label: 'kb.delete' },
      { keys: 'Enter', label: 'kb.finishWall' },
    ],
  },
  {
    title: 'kb.furniture',
    items: [
      { keys: 'R', label: 'kb.rotate' },
      { keys: 'Shift+R', label: 'kb.rotateBack' },
      { keys: '← ↑ ↓ →', label: 'kb.nudge' },
      { keys: 'Shift+← ↑ ↓ →', label: 'kb.nudgeBig' },
      { keys: 'Mod+D', label: 'kb.duplicate' },
    ],
  },
  {
    title: 'kb.view3d',
    items: [
      { keys: 'F', label: 'cmd.focus' },
      { keys: 'Double-click', label: 'kb.dblFocus' },
      { keys: 'W A S D', label: 'kb.walkMove' },
      { keys: 'Shift', label: 'kb.walkRun' },
      { keys: 'Esc', label: 'kb.walkExit' },
    ],
  },
];
