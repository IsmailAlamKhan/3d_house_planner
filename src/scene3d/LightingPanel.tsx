import { Sun } from 'lucide-react';
import { useState } from 'react';
import { usePack } from '../assets/pack';
import { useLightStyle } from './SceneLights';
import { useT } from '../i18n';
import { useModel } from '../model/store';
import {
  type LightingPreset,
  PRESET_TIME,
  DAY_END,
  DAY_START,
  formatTime,
  timeOf,
} from './lighting';
import { type QualityChoice, autoQuality } from './quality';
import { useSceneStore } from './sceneStore';

const PRESETS: {
  id: LightingPreset;
  label:
    | 'light.morning'
    | 'light.noon'
    | 'light.evening'
    | 'light.night'
    | 'light.marketing'
    | 'light.dusk';
}[] = [
  { id: 'morning', label: 'light.morning' },
  { id: 'noon', label: 'light.noon' },
  { id: 'evening', label: 'light.evening' },
  { id: 'night', label: 'light.night' },
  { id: 'marketing', label: 'light.marketing' },
  { id: 'dusk', label: 'light.dusk' },
];

const QUALITIES: {
  id: QualityChoice;
  label: 'quality.auto' | 'quality.low' | 'quality.medium' | 'quality.high';
}[] = [
  { id: 'auto', label: 'quality.auto' },
  { id: 'low', label: 'quality.low' },
  { id: 'medium', label: 'quality.medium' },
  { id: 'high', label: 'quality.high' },
];

/** Compass control: commits to the project when the slider is released (one undo step). */
function CompassSlider() {
  const t = useT();
  const compass = useModel((s) => s.project.settings.compass);
  const apply = useModel((s) => s.apply);
  const [draft, setDraft] = useState<number | null>(null);
  const value = draft ?? compass;
  const commit = () => {
    if (draft !== null && Math.round(draft) !== Math.round(compass))
      apply((p) => void (p.settings.compass = Math.round(draft)));
    setDraft(null);
  };
  return (
    <label className="block text-xs text-slate-600">
      <span className="flex items-center justify-between">
        {t('light.compass')}
        <span className="tabular-nums">{Math.round(value)}°</span>
      </span>
      <span className="flex items-center gap-2">
        <span
          aria-hidden
          className="inline-flex h-6 w-6 items-center justify-center rounded-full border border-slate-300 text-[10px] font-bold text-slate-600"
          style={{ transform: `rotate(${-value}deg)` }}
        >
          N
        </span>
        <input
          type="range"
          min={0}
          max={359}
          step={1}
          value={value}
          aria-label={t('light.compass')}
          onChange={(e) => setDraft(Number(e.target.value))}
          onPointerUp={commit}
          onKeyUp={commit}
          onBlur={commit}
          className="flex-1"
        />
      </span>
      <span className="text-[11px] text-slate-500">{t('light.compassHint')}</span>
    </label>
  );
}

/** Realistic / design lighting, exposure, night visibility, the lamp switches and the user's own presets. */
function LightControls() {
  const t = useT();
  const style = useLightStyle();
  const { lighting, exposure, nightVisibility, customPresets, setPref } = useSceneStore();
  const master = useModel((s) => s.project.lights.master);
  const setLights = useModel((s) => s.setLights);
  const [name, setName] = useState('');
  const seg = (on: boolean) =>
    `rounded px-2 py-1 text-xs ${on ? 'bg-sky-700 font-semibold text-white' : 'bg-slate-100 text-slate-700 hover:bg-slate-200'}`;
  return (
    <div className="space-y-2 border-t border-slate-200 pt-2">
      <div role="group" aria-label={t('light.style')} className="grid grid-cols-2 gap-1">
        {(['realistic', 'design'] as const).map((k) => (
          <button
            key={k}
            data-testid={`light-style-${k}`}
            aria-pressed={style === k}
            className={seg(style === k)}
            onClick={() => setPref('lightStyle', k)}
            title={t(`light.style.${k}Hint` as 'light.style.realisticHint')}
          >
            {t(`light.style.${k}` as 'light.style.realistic')}
          </button>
        ))}
      </div>
      <div role="group" aria-label={t('light.lamps')} className="grid grid-cols-3 gap-1">
        {(['auto', 'on', 'off'] as const).map((m) => (
          <button
            key={m}
            data-testid={`lamps-${m}`}
            aria-pressed={master === m}
            className={seg(master === m)}
            onClick={() => setLights((l) => void ((l.master = m), (l.rooms = {}), (l.items = {})))}
          >
            {t(`light.lamps.${m}` as 'light.lamps.auto')}
          </button>
        ))}
      </div>
      <label className="block text-xs text-slate-600">
        <span className="flex items-center justify-between">
          {t('light.exposure')}
          <span className="tabular-nums">
            {exposure > 0 ? '+' : ''}
            {exposure.toFixed(1)} EV
          </span>
        </span>
        <input
          type="range"
          min={-3}
          max={3}
          step={0.1}
          value={exposure}
          aria-label={t('light.exposure')}
          onChange={(e) => setPref('exposure', Number(e.target.value))}
          onDoubleClick={() => setPref('exposure', 0)}
          className="w-full"
        />
      </label>
      {style === 'realistic' && (
        <label className="block text-xs text-slate-600">
          <span className="flex items-center justify-between">
            {t('light.nightVisibility')}
            <span className="tabular-nums">{Math.round(nightVisibility * 100)} %</span>
          </span>
          <input
            type="range"
            min={0}
            max={0.1}
            step={0.005}
            value={nightVisibility}
            data-testid="night-visibility"
            aria-label={t('light.nightVisibility')}
            onChange={(e) => setPref('nightVisibility', Number(e.target.value))}
            className="w-full"
          />
        </label>
      )}
      <div className="space-y-1 text-xs">
        <div className="flex gap-1">
          <input
            className="min-w-0 flex-1 rounded border border-slate-300 px-1 py-0.5"
            placeholder={t('light.presetName')}
            aria-label={t('light.presetName')}
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
          <button
            className={seg(false)}
            disabled={!name.trim()}
            onClick={() => {
              setPref('customPresets', [
                ...customPresets.filter((p) => p.name !== name.trim()),
                { name: name.trim(), lighting, master },
              ]);
              setName('');
            }}
          >
            {t('light.savePreset')}
          </button>
        </div>
        {customPresets.map((p) => (
          <div key={p.name} className="flex items-center gap-1">
            <button
              className={`${seg(false)} flex-1 text-left`}
              onClick={() => {
                setPref('lighting', p.lighting);
                setLights((l) => void (l.master = p.master));
              }}
            >
              {p.name}
            </button>
            <button
              aria-label={`${t('light.deletePreset')} ${p.name}`}
              className={seg(false)}
              onClick={() =>
                setPref(
                  'customPresets',
                  customPresets.filter((x) => x.name !== p.name),
                )
              }
            >
              ×
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}

/** Sun-and-quality popover for the 3D view. */
export function LightingPanel() {
  const t = useT();
  const [open, setOpen] = useState(false);
  const { lighting, quality, showFps, fps, setPref } = useSceneStore();
  const packStatus = usePack((s) => s.status);
  const packEnabled = usePack((s) => s.enabled);
  const time = timeOf(lighting);
  return (
    <div className="relative">
      <button
        title={t('light.title')}
        aria-label={t('light.title')}
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        className={`rounded-md p-2 ${open ? 'bg-sky-100 text-sky-700' : 'text-slate-600 hover:bg-slate-100'}`}
      >
        <Sun size={18} />
      </button>
      {open && (
        <div
          role="dialog"
          aria-label={t('light.title')}
          className="absolute right-0 top-full z-20 mt-1 w-64 max-w-[calc(100vw-1rem)] space-y-3 rounded-lg border border-slate-200 bg-white p-3 shadow-lg"
        >
          <div role="group" aria-label={t('light.presets')} className="grid grid-cols-3 gap-1">
            {PRESETS.map((p) => (
              <button
                key={p.id}
                aria-pressed={lighting.mode === p.id}
                onClick={() => {
                  setPref('lighting', { mode: p.id, time: PRESET_TIME[p.id] });
                  // A preset sets the sky and the lamps together: back to "follow the preset".
                  useModel.getState().setLights((l) => void (l.master = 'auto'));
                }}
                className={`rounded px-1 py-1 text-xs ${lighting.mode === p.id ? 'bg-sky-700 font-semibold text-white' : 'bg-slate-100 text-slate-700 hover:bg-slate-200'}`}
              >
                {t(p.label)}
              </button>
            ))}
          </div>
          <label className="block text-xs text-slate-600">
            <span className="flex items-center justify-between">
              {t('light.time')}
              <span className="tabular-nums">
                {lighting.mode === 'night' ? t('light.night') : formatTime(time)}
              </span>
            </span>
            <input
              type="range"
              min={DAY_START}
              max={DAY_END}
              step={0.25}
              value={Math.min(DAY_END, Math.max(DAY_START, time))}
              aria-label={t('light.time')}
              onChange={(e) =>
                setPref('lighting', { mode: 'custom', time: Number(e.target.value) })
              }
              className="w-full"
            />
          </label>
          <CompassSlider />
          <LightControls />
          <label className="flex items-center justify-between text-xs text-slate-600">
            {t('quality.title')}
            <select
              value={quality}
              onChange={(e) => setPref('quality', e.target.value as QualityChoice)}
              className="rounded border border-slate-300 bg-white px-1 py-0.5 text-xs"
            >
              {QUALITIES.map((q) => (
                <option key={q.id} value={q.id}>
                  {t(q.label)}
                  {q.id === 'auto' ? ` (${autoQuality()})` : ''}
                </option>
              ))}
            </select>
          </label>
          <label className="flex items-center justify-between text-xs text-slate-600">
            {t('quality.fps')}
            <span className="flex items-center gap-2">
              {showFps && <span className="tabular-nums text-slate-500">{fps} fps</span>}
              <input
                type="checkbox"
                checked={showFps}
                onChange={(e) => setPref('showFps', e.target.checked)}
              />
            </span>
          </label>
          <label
            className="flex items-center justify-between text-xs text-slate-600"
            title={packStatus === 'none' ? t('pack.missing') : undefined}
          >
            {t('pack.use')}
            <input
              type="checkbox"
              checked={packEnabled && packStatus !== 'none'}
              disabled={packStatus === 'none'}
              onChange={(e) => usePack.getState().setEnabled(e.target.checked)}
            />
          </label>
        </div>
      )}
    </div>
  );
}
