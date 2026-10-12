import { DoorOpen, Home, Maximize, Move3d, Pipette, Rotate3d } from 'lucide-react';
import { EyedropperHint } from '../app/EyedropperHint';
import { LightingPanel } from './LightingPanel';
import { CameraToolbar } from './camera/CameraToolbar';
import { useModel } from '../model/store';
import type { ReactNode } from 'react';
import { useT } from '../i18n';
import type { WallMode } from './sceneModel';
import { type LevelFilter, useSceneStore } from './sceneStore';

function Toggle({
  active,
  label,
  onClick,
  children,
}: {
  active: boolean;
  label: string;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      title={label}
      aria-label={label}
      aria-pressed={active}
      onClick={onClick}
      className={`rounded-md p-2 ${active ? 'bg-sky-100 text-sky-700' : 'text-slate-600 hover:bg-slate-100'}`}
    >
      {children}
    </button>
  );
}

function Segmented<T extends string>({
  value,
  options,
  onChange,
  label,
}: {
  value: T;
  options: { id: T; label: string }[];
  onChange: (v: T) => void;
  label: string;
}) {
  return (
    <div role="group" aria-label={label} className="flex rounded-md bg-slate-100 p-0.5 text-xs">
      {options.map((o) => (
        <button
          key={o.id}
          aria-pressed={value === o.id}
          onClick={() => onChange(o.id)}
          className={`rounded px-2 py-1 ${value === o.id ? 'bg-white font-semibold shadow-sm' : 'text-slate-600'}`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function SceneToolbar() {
  const t = useT();
  const tool = useModel((s) => s.tool);
  const setTool = useModel((s) => s.setTool);
  const { levelFilter, dollhouse, wallMode, doorsOpen, gizmoMode, setPref, resetCamera } =
    useSceneStore();
  return (
    <div className="pointer-events-none absolute left-2 top-2 flex max-w-[calc(100%-1rem)] flex-col items-start gap-1">
      <div
        role="toolbar"
        aria-label="3D view options"
        className="pointer-events-auto flex flex-wrap items-center gap-1 rounded-lg border border-slate-200 bg-white/95 p-1 shadow-sm"
      >
        <Segmented<LevelFilter>
          label={t('view3d.levels')}
          value={levelFilter}
          onChange={(v) => setPref('levelFilter', v)}
          options={[
            { id: 'all', label: t('view3d.allLevels') },
            { id: 'below', label: t('view3d.activeBelow') },
          ]}
        />
        <Segmented<WallMode>
          label={t('view3d.walls')}
          value={wallMode}
          onChange={(v) => setPref('wallMode', v)}
          options={[
            { id: 'up', label: t('view3d.wallsUp') },
            { id: 'cut', label: t('view3d.wallsCut') },
            { id: 'transparent', label: t('view3d.wallsTransparent') },
          ]}
        />
        <Toggle
          active={dollhouse}
          label={t('view3d.dollhouse')}
          onClick={() => setPref('dollhouse', !dollhouse)}
        >
          <Home size={18} />
        </Toggle>
        <Toggle
          active={doorsOpen}
          label={t('view3d.doorsOpen')}
          onClick={() => setPref('doorsOpen', !doorsOpen)}
        >
          <DoorOpen size={18} />
        </Toggle>
        <Toggle
          active={gizmoMode === 'translate'}
          label={t('view3d.gizmoMove')}
          onClick={() => setPref('gizmoMode', 'translate')}
        >
          <Move3d size={18} />
        </Toggle>
        <Toggle
          active={gizmoMode === 'rotate'}
          label={t('view3d.gizmoRotate')}
          onClick={() => setPref('gizmoMode', 'rotate')}
        >
          <Rotate3d size={18} />
        </Toggle>
        <Toggle
          active={tool === 'eyedropper'}
          label={t('tool.eyedropper')}
          onClick={() => setTool(tool === 'eyedropper' ? 'select' : 'eyedropper')}
        >
          <Pipette size={18} />
        </Toggle>
        <LightingPanel />
        <Toggle active={false} label={t('view3d.resetCamera')} onClick={resetCamera}>
          <Maximize size={18} />
        </Toggle>
      </div>
      <CameraToolbar />
      {tool === 'eyedropper' && <EyedropperHint />}
    </div>
  );
}
