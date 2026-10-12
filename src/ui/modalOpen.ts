/** True while a modal dialog is on screen (global keyboard shortcuts stand down so typing and Tab work). */
export const modalOpen = (): boolean =>
  typeof document !== 'undefined' && !!document.querySelector('[aria-modal="true"]');
