import {
  Camera,
  Eye,
  Footprints,
  Layers,
  PersonStanding,
  Ruler,
  Scissors,
  ScanEye,
  Trash2,
  View,
} from 'lucide-react';
import { type ReactNode, useState } from 'react';
import { fmtNum, useT } from '../../i18n';
import { useModel } from '../../model/store';
import { type CameraMode, useCamera } from './cameraStore';
import { PRESETS, type Preset, modelBox, presetPose } from './views';
import { useSceneStore } from '../sceneStore';

const btn = (active: boolean) =>
  `inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs ${active ? 'bg-sky-100 text-sky-700' : 'text-slate-600 hover:bg-slate-100'}`;

function Popover({
  label,
  icon,
  active,
  children,
}: {
  label: string;
  icon: ReactNode;
  active?: boolean;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  return (
    <div className="relative">
      <button
        title={label}
        aria-label={label}
        aria-expanded={open}
        className={btn(!!active || open)}
        onClick={() => setOpen(!open)}
      >
        {icon}
        <span className="hidden xl:inline">{label}</span>
      </button>
      {open && (
        <div
          role="group"
          aria-label={label}
          className="absolute left-0 top-full z-20 mt-1 w-64 space-y-2 rounded-lg border border-slate-200 bg-white p-3 text-sm shadow-lg"
        >
          {children}
        </div>
      )}
    </div>
  );
}

function Slider({
  label,
  value,
  min,
  max,
  step = 0.05,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  onChange: (v: number) => void;
}) {
  const t = useT();
  return (
    <label className="block text-xs text-slate-600">
      <span className="flex justify-between">
        {label}
        <span>
          {fmtNum(value, 2)} {t('unit.m')}
        </span>
      </span>
      <input
        type="range"
        className="w-full"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(parseFloat(e.target.value))}
      />
    </label>
  );
}

function SectionControls() {
  const t = useT();
  const section = useCamera((s) => s.section);
  const setSection = useCamera((s) => s.setSection);
  const project = useModel((s) => s.project);
  const m = modelBox(project);
  const { horizontal: h, vertical: v } = section;
  const span =
    v.axis === 'x'
      ? [m.cx - m.width / 2, m.cx + m.width / 2]
      : [m.cz - m.depth / 2, m.cz + m.depth / 2];
  return (
    <>
      <label className="flex items-center gap-2">
        <input
          type="checkbox"
          checked={h.on}
          onChange={(e) => setSection({ horizontal: { ...h, on: e.target.checked } })}
        />
        {t('cam.sectionH')}
      </label>
      {h.on && (
        <Slider
          label={t('cam.sectionHHeight')}
          value={h.height}
          min={0.1}
          max={Math.max(m.top, 1)}
          onChange={(height) => setSection({ horizontal: { ...h, height } })}
        />
      )}
      <label className="flex items-center gap-2">
        <input
          type="checkbox"
          checked={v.on}
          onChange={(e) =>
            setSection({
              vertical: {
                ...v,
                on: e.target.checked,
                pos: v.on ? v.pos : (span[0]! + span[1]!) / 2,
              },
            })
          }
        />
        {t('cam.sectionV')}
      </label>
      {v.on && (
        <>
          <div className="flex items-center gap-2 text-xs">
            <select
              aria-label={t('cam.sectionAxis')}
              className="rounded border border-slate-300 px-1 py-0.5"
              value={v.axis}
              onChange={(e) => {
                const axis = e.target.value as 'x' | 'z';
                const s =
                  axis === 'x'
                    ? [m.cx - m.width / 2, m.cx + m.width / 2]
                    : [m.cz - m.depth / 2, m.cz + m.depth / 2];
                setSection({ vertical: { ...v, axis, pos: (s[0]! + s[1]!) / 2 } });
              }}
            >
              <option value="x">{t('cam.axisX')}</option>
              <option value="z">{t('cam.axisZ')}</option>
            </select>
            <label className="flex items-center gap-1">
              <input
                type="checkbox"
                checked={v.flip}
                onChange={(e) => setSection({ vertical: { ...v, flip: e.target.checked } })}
              />
              {t('cam.sectionFlip')}
            </label>
          </div>
          <Slider
            label={t('cam.sectionPos')}
            value={v.pos}
            min={span[0]!}
            max={span[1]!}
            onChange={(pos) => setSection({ vertical: { ...v, pos } })}
          />
        </>
      )}
    </>
  );
}

function IsolateControls() {
  const t = useT();
  const isolation = useCamera((s) => s.isolation);
  const setIsolation = useCamera((s) => s.setIsolation);
  const xray = useCamera((s) => s.xray);
  const setXray = useCamera((s) => s.setXray);
  const activeLevelId = useModel((s) => s.activeLevelId);
  const selection = useModel((s) => s.selection);
  const roomId = selection.type === 'room' ? selection.ids[0] : undefined;
  const row = (
    on: boolean,
    label: string,
    onClick: () => void,
    disabled = false,
    hint?: string,
  ) => (
    <button
      className={`${btn(on)} w-full justify-start disabled:opacity-40`}
      aria-pressed={on}
      disabled={disabled}
      title={hint}
      onClick={onClick}
    >
      {label}
    </button>
  );
  return (
    <>
      {row(isolation.kind === 'none', t('cam.isoNone'), () => setIsolation({ kind: 'none' }))}
      {row(isolation.kind === 'level', t('cam.isoLevel'), () =>
        setIsolation({ kind: 'level', levelId: activeLevelId }),
      )}
      {row(
        isolation.kind === 'room',
        t('cam.isoRoom'),
        () => roomId && setIsolation({ kind: 'room', roomId }),
        !roomId && isolation.kind !== 'room',
        t('cam.isoRoomHint'),
      )}
      {row(xray, t('cam.xray'), () => setXray(!xray))}
    </>
  );
}

function SaveView() {
  const t = useT();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const mode = useCamera((s) => s.mode);
  const save = () => {
    if (!name.trim()) return;
    useCamera.getState().requestCapture(name.trim());
    setName('');
    setOpen(false);
  };
  return (
    <div className="relative">
      <button
        className={`${btn(open)} disabled:opacity-40`}
        title={t('cam.saveView')}
        aria-label={t('cam.saveView')}
        disabled={mode === 'walk'}
        onClick={() => setOpen(!open)}
      >
        <Camera size={16} />
      </button>
      {open && (
        <form
          className="absolute left-0 top-full z-20 mt-1 flex w-64 gap-1 rounded-lg border border-slate-200 bg-white p-2 shadow-lg"
          onSubmit={(e) => {
            e.preventDefault();
            save();
          }}
        >
          <input
            autoFocus
            aria-label={t('cam.viewName')}
            placeholder={t('cam.viewNamePh')}
            className="min-w-0 flex-1 rounded border border-slate-300 px-2 py-1 text-sm"
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
          <button type="submit" className="rounded bg-slate-800 px-2 py-1 text-sm text-white">
            {t('cam.save')}
          </button>
        </form>
      )}
    </div>
  );
}

/** Camera modes, standard views, section, isolation, measuring and saved views for the 3D viewport. */
export function CameraToolbar({ readOnly = false }: { readOnly?: boolean }) {
  const t = useT();
  const mode = useCamera((s) => s.mode);
  const setMode = useCamera((s) => s.setMode);
  const flyTo = useCamera((s) => s.flyTo);
  const measuring = useCamera((s) => s.measuring);
  const setMeasuring = useCamera((s) => s.setMeasuring);
  const hasMeasurements = useCamera((s) => s.measurements.length > 0 || !!s.pending);
  const sectionOn = useCamera((s) => s.section.horizontal.on || s.section.vertical.on);
  const isolated = useCamera((s) => s.isolation.kind !== 'none' || s.xray);

  const goPreset = (p: Preset) => {
    const el = document.querySelector('[data-testid="scene-canvas"]');
    const aspect = el ? el.clientWidth / Math.max(el.clientHeight, 1) : 1.6;
    if (mode !== 'orbit') setMode('orbit');
    if (p === 'plan') useSceneStore.getState().setPref('dollhouse', true);
    flyTo(presetPose(useModel.getState().project, p, aspect));
  };
  const modes: { id: CameraMode; label: string; icon: ReactNode }[] = [
    { id: 'orbit', label: t('cam.orbit'), icon: <ScanEye size={16} /> },
    { id: 'walk', label: t('cam.walk'), icon: <Footprints size={16} /> },
    { id: 'top', label: t('cam.top'), icon: <View size={16} /> },
  ];
  return (
    <div
      role="toolbar"
      aria-label={t('cam.mode')}
      className="pointer-events-auto flex flex-wrap items-center gap-1 rounded-lg border border-slate-200 bg-white/95 p-1 shadow-sm"
    >
      <div
        role="group"
        aria-label={t('cam.mode')}
        data-tour="camera-modes"
        className="flex rounded-md bg-slate-100 p-0.5"
      >
        {modes.map((m) => (
          <button
            key={m.id}
            aria-pressed={mode === m.id}
            title={m.label}
            onClick={() => setMode(m.id)}
            className={`inline-flex items-center gap-1 rounded px-2 py-1 text-xs ${mode === m.id ? 'bg-white font-semibold shadow-sm' : 'text-slate-600'}`}
          >
            {m.icon}
            {m.label}
          </button>
        ))}
      </div>
      <div role="group" aria-label={t('cam.presets')} className="flex">
        {PRESETS.map((p) => (
          <button key={p} className={btn(false)} onClick={() => goPreset(p)}>
            {t(`cam.${p}` as 'cam.front')}
          </button>
        ))}
      </div>
      <Popover label={t('cam.section')} icon={<Scissors size={16} />} active={sectionOn}>
        <SectionControls />
      </Popover>
      <Popover label={t('cam.isolate')} icon={<Layers size={16} />} active={isolated}>
        <IsolateControls />
      </Popover>
      <button
        title={t('cam.measure')}
        aria-label={t('cam.measure')}
        aria-pressed={measuring}
        className={btn(measuring)}
        onClick={() => setMeasuring(!measuring)}
      >
        <Ruler size={16} />
      </button>
      {hasMeasurements && (
        <button
          title={t('cam.measureClear')}
          aria-label={t('cam.measureClear')}
          className={btn(false)}
          onClick={() => useCamera.getState().clearMeasurements()}
        >
          <Trash2 size={16} />
        </button>
      )}
      {!readOnly && <SaveView />}
      {mode === 'walk' && <PersonStanding size={16} className="text-sky-600" aria-hidden />}
      {measuring && (
        <span role="status" className="px-1 text-xs text-orange-700">
          <Eye size={12} className="mr-1 inline" />
          {t('cam.measureHint')}
        </span>
      )}
    </div>
  );
}
