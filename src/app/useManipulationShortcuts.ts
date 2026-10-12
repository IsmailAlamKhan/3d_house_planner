import { useEffect } from 'react';
import { useCatalogDrag } from '../catalog/dragStore';
import {
  deleteSelectedCatalog,
  duplicateSelected,
  nudgeSelection,
  rotateSelectedItems,
} from '../catalog/actions';
import { useModel } from '../model/store';

const NUDGE = 0.05;
const BIG_NUDGE = 0.25;

/**
 * Keys for whatever is selected, in every view (2D, 3D or split):
 * R rotate item 90°, Ctrl/Cmd+D duplicate, arrows nudge (Shift = bigger step), Delete removes
 * furniture / doors / windows, Esc drops a library item you were about to place.
 */
export function useManipulationShortcuts(): void {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null;
      if (
        el &&
        (el.tagName === 'INPUT' ||
          el.tagName === 'TEXTAREA' ||
          el.tagName === 'SELECT' ||
          el.isContentEditable)
      )
        return;
      const { selection } = useModel.getState();
      const catalogSel =
        selection.type === 'item' || selection.type === 'opening' || selection.type === 'stair';

      if (e.key === 'Escape' && useCatalogDrag.getState().armedId) {
        useCatalogDrag.getState().setArmed(null);
        return;
      }
      if (e.key === 'Escape' && useModel.getState().tool === 'eyedropper') {
        useModel.getState().setTool('select');
        return;
      }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'd') {
        e.preventDefault();
        duplicateSelected();
        return;
      }
      if (e.ctrlKey || e.metaKey || e.altKey || !catalogSel) return;
      const step = e.shiftKey ? BIG_NUDGE : NUDGE;
      switch (e.key) {
        case 'r':
        case 'R':
          if (selection.type === 'item' || selection.type === 'stair') {
            e.preventDefault();
            rotateSelectedItems(e.shiftKey ? -Math.PI / 2 : Math.PI / 2);
          }
          break;
        case 'Delete':
        case 'Backspace':
          e.preventDefault();
          deleteSelectedCatalog();
          break;
        case 'ArrowLeft':
          e.preventDefault();
          nudgeSelection(-step, 0);
          break;
        case 'ArrowRight':
          e.preventDefault();
          nudgeSelection(step, 0);
          break;
        case 'ArrowUp':
          e.preventDefault();
          nudgeSelection(0, -step);
          break;
        case 'ArrowDown':
          e.preventDefault();
          nudgeSelection(0, step);
          break;
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
}
