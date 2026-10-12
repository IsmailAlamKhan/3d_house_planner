/** Is this a Mac (⌘ instead of Ctrl)? */
export const isMac = (): boolean =>
  typeof navigator !== 'undefined' &&
  /Mac|iPhone|iPad/i.test(navigator.platform || navigator.userAgent);

/** Shows a shortcut for this platform: "Mod+K" → "⌘K" on a Mac and "Ctrl+K" elsewhere. */
export function formatShortcut(shortcut: string): string {
  const mac = isMac();
  return shortcut
    .split('+')
    .map((k) => {
      switch (k) {
        case 'Mod':
          return mac ? '⌘' : 'Ctrl';
        case 'Shift':
          return mac ? '⇧' : 'Shift';
        case 'Alt':
          return mac ? '⌥' : 'Alt';
        default:
          return k;
      }
    })
    .join(mac ? '' : '+');
}

/** "Undo" + "Mod+Z" → "Undo (Ctrl+Z)" for tooltips. */
export const withShortcut = (label: string, shortcut?: string): string =>
  shortcut ? `${label} (${formatShortcut(shortcut)})` : label;
