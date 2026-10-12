import { Html } from '@react-three/drei';
import { useExportFlags } from '../export/flags';
import { useT } from '../i18n';
import { notePin } from '../model/ops';
import { useModel } from '../model/store';
import { useCamera } from '../scene3d/camera/cameraStore';
import { useUiStore } from '../ui/uiStore';

/** Note pins floating in the 3D view (click one to open it in the Notes panel). */
export function NotePins3D() {
  const t = useT();
  const project = useModel((s) => s.project);
  const activeId = useUiStore((s) => s.activeNoteId);
  const presentation = useExportFlags((s) => s.presentation);
  const walking = useCamera((s) => s.mode === 'walk');
  if (presentation || walking || !project.notes.length) return null;
  return (
    <>
      {project.notes.map((n, i) => {
        const pin = notePin(project, n);
        const level = project.levels.find((l) => l.id === pin.levelId);
        if (!level?.visible) return null;
        return (
          <Html
            key={n.id}
            position={[pin.position.x, level.elevation + 1.6, pin.position.y]}
            center
            zIndexRange={[15, 0]}
            style={{ pointerEvents: 'none' }}
          >
            <button
              data-testid="note-pin-3d"
              aria-label={`${t('notes.pin')} ${i + 1}${n.text ? `: ${n.text}` : ''}`}
              title={n.text || t('notes.pin')}
              onClick={() => {
                const ui = useUiStore.getState();
                ui.setActiveNoteId(n.id);
                ui.setLeftTab('notes');
                ui.setLeftDrawerOpen(window.innerWidth < 1024);
                useModel.getState().setActiveLevel(pin.levelId);
              }}
              className={`pointer-events-auto flex h-6 w-6 items-center justify-center rounded-full border text-xs font-bold shadow ${n.resolved ? 'border-slate-500 bg-slate-300 text-slate-800' : 'border-amber-800 bg-amber-400 text-stone-900'} ${activeId === n.id ? 'ring-2 ring-sky-500' : ''}`}
            >
              {i + 1}
            </button>
          </Html>
        );
      })}
    </>
  );
}
