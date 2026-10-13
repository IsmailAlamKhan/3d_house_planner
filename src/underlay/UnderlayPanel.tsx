import { ImageUp, X } from 'lucide-react';
import { useRef } from 'react';
import { toast } from '../catalog/actions';
import { t, useT } from '../i18n';
import * as ops from '../model/ops';
import { ModelError } from '../model/ops';
import { edit, useModel } from '../model/store';
import type { Underlay } from '../model/types';
import { forgetLocalImage, imageSize } from './source';
import { useUnderlayUi } from './uiStore';
import { underlayBlob } from './source';

const NUDGE = 0.05;

function run(fn: () => void) {
  try {
    fn();
  } catch (e) {
    toast(e instanceof ModelError ? e.message : String(e));
  }
}

async function restraighten(u: Underlay) {
  try {
    const blob = await underlayBlob(u.source);
    useUnderlayUi.getState().openSetup({
      imageUrl: URL.createObjectURL(blob),
      width: u.imageWidth,
      height: u.imageHeight,
      name: u.name,
      file: blob,
      editId: u.id,
      source: u.source,
      mode: u.setup?.mode === 'two-point' ? 'two-point' : 'corners',
      points: u.setup?.points,
      size: u.setup?.size,
      origin: u.setup?.origin,
    });
  } catch {
    toast(t('underlay.failed'));
  }
}

function Row({ u }: { u: Underlay }) {
  const tt = useT();
  const patch = (p: Partial<Omit<Underlay, 'id' | 'transform'>>) =>
    run(() => edit((d) => ops.updateUnderlay(d, u.id, p)));
  const check = (key: 'visible' | 'locked' | 'onTop' | 'show3d', label: string) => (
    <label className="flex items-center gap-1 text-xs">
      <input
        type="checkbox"
        checked={u[key]}
        onChange={(e) => patch({ [key]: e.target.checked })}
      />
      {label}
    </label>
  );
  const nudge = (dx: number, dy: number) =>
    patch({ offset: { x: u.offset.x + dx, y: u.offset.y + dy } });
  return (
    <li
      className="flex flex-col gap-1 rounded border border-slate-200 p-2"
      data-testid="underlay-row"
    >
      <div className="flex items-center justify-between text-sm font-medium">
        <span className="truncate">{u.name}</span>
        <button
          aria-label={tt('underlay.remove')}
          title={tt('underlay.remove')}
          className="rounded p-1 hover:bg-slate-100"
          onClick={() =>
            run(() => {
              edit((d) => ops.deleteUnderlay(d, u.id));
              void forgetLocalImage(u.source);
            })
          }
        >
          <X size={14} />
        </button>
      </div>
      <label className="flex items-center gap-2 text-xs">
        {tt('underlay.opacity')}
        <input
          type="range"
          min={0}
          max={1}
          step={0.05}
          value={u.opacity}
          aria-label={tt('underlay.opacity')}
          onChange={(e) => patch({ opacity: Number(e.target.value) })}
          className="flex-1"
        />
        <span className="w-8 tabular-nums">{Math.round(u.opacity * 100)}%</span>
      </label>
      <div className="flex flex-wrap gap-x-3 gap-y-1">
        {check('visible', tt('underlay.visible'))}
        {check('locked', tt('underlay.locked'))}
        {check('onTop', tt('underlay.onTop'))}
        {check('show3d', tt('underlay.show3d'))}
      </div>
      <div className="flex flex-wrap items-center gap-1 text-xs">
        <button
          className="rounded border px-1.5"
          aria-label={`${tt('underlay.moveX')} −`}
          onClick={() => nudge(-NUDGE, 0)}
        >
          ←
        </button>
        <button
          className="rounded border px-1.5"
          aria-label={`${tt('underlay.moveX')} +`}
          onClick={() => nudge(NUDGE, 0)}
        >
          →
        </button>
        <button
          className="rounded border px-1.5"
          aria-label={`${tt('underlay.moveY')} −`}
          onClick={() => nudge(0, -NUDGE)}
        >
          ↑
        </button>
        <button
          className="rounded border px-1.5"
          aria-label={`${tt('underlay.moveY')} +`}
          onClick={() => nudge(0, NUDGE)}
        >
          ↓
        </button>
        <label className="ml-2 flex items-center gap-1">
          {tt('underlay.rotate')}
          <input
            type="number"
            step={0.1}
            value={Math.round(((u.rotation * 180) / Math.PI) * 100) / 100}
            onChange={(e) => patch({ rotation: (Number(e.target.value) * Math.PI) / 180 })}
            className="w-16 rounded border border-slate-300 px-1"
          />
        </label>
      </div>
      <div className="flex gap-2 text-xs">
        <button
          className="rounded border px-2 py-0.5"
          onClick={() => run(() => edit((d) => ops.sendUnderlayToBack(d, u.id)))}
        >
          {tt('underlay.toBack')}
        </button>
        <button className="rounded border px-2 py-0.5" onClick={() => void restraighten(u)}>
          {tt('underlay.straighten')}
        </button>
      </div>
    </li>
  );
}

/** Opens the file chooser and, once the picture is read, the straighten dialog. */
export function useImportUnderlay() {
  const input = useRef<HTMLInputElement>(null);
  const onFile = async (file: File | undefined) => {
    if (!file) return;
    try {
      const size = await imageSize(file);
      useUnderlayUi.getState().openSetup({
        imageUrl: URL.createObjectURL(file),
        width: size.width,
        height: size.height,
        name: file.name.replace(/\.[^.]+$/, '') || t('underlay.imageName'),
        file,
      });
    } catch (e) {
      toast(e instanceof Error ? e.message : t('underlay.failed'));
    }
  };
  return { input, onFile, choose: () => input.current?.click() };
}

/** Floating list of the project's reference pictures with their controls. */
export function UnderlayPanel() {
  const tt = useT();
  const open = useUnderlayUi((s) => s.panelOpen);
  const underlays = useModel((s) => s.project.underlays);
  const { input, onFile, choose } = useImportUnderlay();
  if (!open) return null;
  return (
    <section
      aria-label={tt('underlay.title')}
      data-testid="underlay-panel"
      className="pointer-events-auto absolute left-2 top-14 z-10 flex max-h-[70%] w-72 flex-col gap-2 overflow-auto rounded-lg border border-slate-200 bg-white/95 p-2 text-slate-800 shadow-md"
    >
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold">{tt('underlay.title')}</h2>
        <button
          aria-label={tt('underlay.cancel')}
          className="rounded p-1 hover:bg-slate-100"
          onClick={() => useUnderlayUi.getState().setPanelOpen(false)}
        >
          <X size={14} />
        </button>
      </div>
      <p className="text-xs text-slate-600">{tt('underlay.hint')}</p>
      <input
        ref={input}
        type="file"
        accept="image/png,image/jpeg,image/webp"
        aria-label={tt('underlay.imageFile')}
        data-testid="underlay-file"
        className="sr-only"
        onChange={(e) => {
          void onFile(e.target.files?.[0]);
          e.target.value = '';
        }}
      />
      <button
        onClick={choose}
        className="flex items-center justify-center gap-1 rounded bg-sky-600 px-2 py-1.5 text-sm text-white"
      >
        <ImageUp size={14} /> {tt('underlay.import')}
      </button>
      {underlays.length === 0 ? (
        <p className="text-xs text-slate-500">{tt('underlay.empty')}</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {underlays.map((u) => (
            <Row key={u.id} u={u} />
          ))}
        </ul>
      )}
    </section>
  );
}
