import {
  Layers,
  Maximize,
  MousePointer2,
  PenLine,
  Pipette,
  Ruler,
  Square,
  Trash2,
  MoveHorizontal,
} from 'lucide-react';
import type { ReactNode } from 'react';
import { type TranslationKey, useT } from '../i18n';
import { useModel } from '../model/store';
import type { Tool } from '../model/types';
import { deleteSelected, fitToShell } from './interaction';
import { EyedropperHint } from '../app/EyedropperHint';
import { usePlanStore } from './planStore';

function Btn({
  active,
  label,
  onClick,
  children,
  disabled,
}: {
  active?: boolean;
  label: string;
  onClick: () => void;
  children: ReactNode;
  disabled?: boolean;
}) {
  return (
    <button
      title={label}
      aria-label={label}
      aria-pressed={active}
      disabled={disabled}
      onClick={onClick}
      className={`rounded-md p-2 disabled:opacity-40 ${active ? 'bg-sky-100 text-sky-700' : 'text-slate-600 hover:bg-slate-100'}`}
    >
      {children}
    </button>
  );
}

const TOOLS: { id: Tool; label: TranslationKey; icon: ReactNode }[] = [
  { id: 'select', label: 'tool.select', icon: <MousePointer2 size={18} /> },
  { id: 'wall', label: 'tool.wall', icon: <PenLine size={18} /> },
  { id: 'room', label: 'tool.room', icon: <Square size={18} /> },
  { id: 'measure', label: 'tool.measure', icon: <Ruler size={18} /> },
  { id: 'eyedropper', label: 'tool.eyedropper', icon: <Pipette size={18} /> },
];

export function PlanToolbar() {
  const t = useT();
  const tool = useModel((s) => s.tool);
  const setTool = useModel((s) => s.setTool);
  const hasSelection = useModel((s) => s.selection.ids.length > 0);
  const { showGhosts, showAllDimensions, roomMode, setPref } = usePlanStore();
  return (
    <div className="pointer-events-none absolute left-2 top-2 flex flex-col gap-1">
      <div
        role="toolbar"
        aria-label="Plan tools"
        className="pointer-events-auto flex items-center gap-0.5 rounded-lg border border-slate-200 bg-white/95 p-1 shadow-sm"
      >
        {TOOLS.map((x) => (
          <Btn key={x.id} active={tool === x.id} label={t(x.label)} onClick={() => setTool(x.id)}>
            {x.icon}
          </Btn>
        ))}
        <Btn label={t('tool.delete')} onClick={deleteSelected} disabled={!hasSelection}>
          <Trash2 size={18} />
        </Btn>
        <span className="mx-1 h-5 w-px bg-slate-200" />
        <Btn
          active={showGhosts}
          label={t('tool.ghosts')}
          onClick={() => setPref('showGhosts', !showGhosts)}
        >
          <Layers size={18} />
        </Btn>
        <Btn
          active={showAllDimensions}
          label={t('tool.dims')}
          onClick={() => setPref('showAllDimensions', !showAllDimensions)}
        >
          <MoveHorizontal size={18} />
        </Btn>
        <Btn label={t('tool.fit')} onClick={fitToShell}>
          <Maximize size={18} />
        </Btn>
      </div>
      {tool === 'eyedropper' && <EyedropperHint />}
      {tool === 'room' && (
        <div className="pointer-events-auto flex rounded-lg border border-slate-200 bg-white/95 p-0.5 text-xs shadow-sm">
          {(['rect', 'poly'] as const).map((m) => (
            <button
              key={m}
              aria-pressed={roomMode === m}
              onClick={() => setPref('roomMode', m)}
              className={`rounded px-2 py-1 ${roomMode === m ? 'bg-sky-100 font-semibold text-sky-700' : 'text-slate-600'}`}
            >
              {t(m === 'rect' ? 'tool.roomRect' : 'tool.roomPoly')}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
