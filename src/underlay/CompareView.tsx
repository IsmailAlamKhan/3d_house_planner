import { X } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { useT } from '../i18n';
import { useModel } from '../model/store';
import type { Underlay } from '../model/types';
import { useCamera } from '../scene3d/camera/cameraStore';
import { focusRect } from './matrix';
import { useRectified } from './useRectified';
import { useUnderlayUi } from './uiStore';

/** Share of the view the plan fills, so the walls are not cut by the edge. */
const FILL = 0.96;
/** The camera moves for 0.7 s; a move that has not arrived by then is asked for again. */
const SETTLE_TICKS = 6;

/** The picture to compare: the top-most visible reference picture. */
export function comparisonTarget(underlays: readonly Underlay[]): Underlay | undefined {
  return [...underlays].reverse().find((u) => u.visible);
}

/**
 * "Compare with reference": the straightened reference picture beside a render of the plan from straight above, with
 * a draggable divider. Both are drawn at the same scale around the same centre (an orthographic camera in pixels per
 * metre, and the picture placed by the same rule), so a wall on one side continues on the other.
 *
 * Opening it (`openCompare` in the store) sets the look of the picture to match: dusk light with every lamp on, no
 * roofs or ceilings, walls cut low. Closing it puts back what it changed.
 */
export function CompareView() {
  const t = useT();
  const open = useUnderlayUi((s) => s.compareOpen);
  const split = useUnderlayUi((s) => s.compareSplit);
  const underlays = useModel((s) => s.project.underlays);
  const u = comparisonTarget(underlays);
  const box = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ w: 0, h: 0 });
  // Which pose the camera has arrived at (the picture is shown only when it is the one wanted now).
  const [arrivedAt, setArrivedAt] = useState('');
  const r = useRectified(u);

  useEffect(() => {
    const el = box.current;
    if (!open || !el) return;
    const read = () => setSize({ w: el.clientWidth, h: el.clientHeight });
    read();
    const ro = new ResizeObserver(read);
    ro.observe(el);
    return () => ro.disconnect();
  }, [open]);

  const bounds = r?.status === 'ready' ? r.bounds : undefined;
  // Frame the plot (what the picture was set up on); the rest of the picture runs off the sides.
  const focus = u ? focusRect(u) : undefined;
  const cx = focus ? (focus.x0 + focus.x1) / 2 : 0;
  const cy = focus ? (focus.y0 + focus.y1) / 2 : 0;
  const zoom =
    focus && size.w > 0 && size.h > 0
      ? Math.min(size.w / (focus.x1 - focus.x0), size.h / (focus.y1 - focus.y0)) * FILL
      : 0;

  // Put the camera exactly over the plot. The top camera may not exist yet when the view opens, so ask again until
  // it reports the wanted pose; the picture appears only then.
  const wanted = `${zoom}|${cx}|${cy}`;
  const ready = arrivedAt === wanted;
  useEffect(() => {
    if (!open || !zoom) return;
    const pose = {
      position: [cx, 200, cy] as [number, number, number],
      target: [cx, 0, cy] as [number, number, number],
      zoom,
    };
    let timer: ReturnType<typeof setTimeout>;
    let tries = 0;
    const arrived = () => {
      const l = useCamera.getState().live;
      return (
        l.zoom !== undefined &&
        Math.abs(l.zoom - zoom) < zoom * 0.003 &&
        Math.abs(l.position[0] - cx) < 0.05 &&
        Math.abs(l.position[2] - cy) < 0.05
      );
    };
    const tick = () => {
      if (arrived()) return setArrivedAt(wanted);
      if (tries++ % SETTLE_TICKS === 0) useCamera.getState().flyTo(pose);
      timer = setTimeout(tick, 150);
    };
    timer = setTimeout(tick, 0);
    return () => clearTimeout(timer);
  }, [open, zoom, cx, cy, wanted]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') useUnderlayUi.getState().closeCompare();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open]);

  if (!open) return null;
  const left = bounds && zoom ? size.w / 2 + (bounds.x0 - cx) * zoom : 0;
  const top = bounds && zoom ? size.h / 2 + (bounds.y0 - cy) * zoom : 0;
  const width = bounds && zoom ? (bounds.x1 - bounds.x0) * zoom : 0;
  const height = bounds && zoom ? (bounds.y1 - bounds.y0) * zoom : 0;
  const dividerX = size.w * split;

  const drag = (e: React.PointerEvent) => {
    const el = box.current;
    if (!el) return;
    el.setPointerCapture(e.pointerId);
    const move = (ev: PointerEvent) => {
      const rect = el.getBoundingClientRect();
      useUnderlayUi.getState().setCompareSplit((ev.clientX - rect.left) / rect.width);
    };
    const up = () => {
      el.removeEventListener('pointermove', move);
      el.removeEventListener('pointerup', up);
    };
    el.addEventListener('pointermove', move);
    el.addEventListener('pointerup', up);
    move(e.nativeEvent);
  };

  return (
    <div
      ref={box}
      role="region"
      aria-label={t('underlay.compare')}
      data-testid="compare-view"
      data-ready={ready && !!bounds}
      className="absolute inset-0 z-30 select-none overflow-hidden"
    >
      {/* The reference picture, clipped to the left of the divider. */}
      <div
        className="absolute inset-0 overflow-hidden"
        style={{
          background: '#0b1220',
          clipPath: `inset(0 ${Math.max(0, size.w - dividerX)}px 0 0)`,
        }}
        aria-hidden
      >
        {bounds && r?.status === 'ready' && (
          <img
            src={r.url}
            alt=""
            draggable={false}
            data-testid="compare-picture"
            className="absolute max-w-none"
            style={{ left, top, width, height, opacity: ready ? 1 : 0 }}
          />
        )}
      </div>
      {!bounds && (
        <p role="status" className="absolute inset-x-0 top-1/2 text-center text-sm text-white">
          {r?.status === 'error' ? t('underlay.failed') : t('underlay.loading')}
        </p>
      )}
      <span className="pointer-events-none absolute left-3 top-3 rounded bg-black/60 px-2 py-0.5 text-xs text-white">
        {t('underlay.compareReference')}
      </span>
      <span className="pointer-events-none absolute right-12 top-3 rounded bg-black/60 px-2 py-0.5 text-xs text-white">
        {t('underlay.compareRender')}
      </span>
      <button
        aria-label={t('underlay.compareClose')}
        title={t('underlay.compareClose')}
        onClick={() => useUnderlayUi.getState().closeCompare()}
        className="absolute right-3 top-3 rounded-full bg-black/60 p-1.5 text-white hover:bg-black/80"
      >
        <X size={14} />
      </button>
      {/* The divider. */}
      <div
        className="absolute inset-y-0 w-0.5 bg-white shadow"
        style={{ left: dividerX - 1 }}
        aria-hidden
      />
      <div
        role="slider"
        tabIndex={0}
        aria-label={t('underlay.compareSlider')}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(split * 100)}
        data-testid="compare-handle"
        onPointerDown={drag}
        onKeyDown={(e) => {
          const s = useUnderlayUi.getState();
          if (e.key === 'ArrowLeft') s.setCompareSplit(s.compareSplit - 0.02);
          if (e.key === 'ArrowRight') s.setCompareSplit(s.compareSplit + 0.02);
        }}
        className="absolute top-1/2 flex h-10 w-6 -translate-y-1/2 cursor-ew-resize items-center justify-center rounded-full bg-white text-xs text-slate-700 shadow-lg outline-none ring-sky-500 focus-visible:ring-2"
        style={{ left: dividerX - 12, touchAction: 'none' }}
      >
        ⇆
      </div>
    </div>
  );
}
