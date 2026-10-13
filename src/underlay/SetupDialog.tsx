import { useRef, useState } from 'react';
import { type Matrix3, rectifyFromCorners, scaleFromTwoPoints } from '../geometry/homography';
import type { Vec2 } from '../geometry/vec';
import { toast } from '../catalog/actions';
import { t, tf, useT } from '../i18n';
import * as ops from '../model/ops';
import { ModelError } from '../model/ops';
import { edit, useModel } from '../model/store';
import { Modal } from '../ui/Modal';
import { formatLength, parseLength } from '../ui/units';
import { forgetLocalImage, storeUnderlayImage } from './source';
import { useUnderlayUi } from './uiStore';

type Mode = 'corners' | 'two-point';

/** Straighten + scale dialog: mark four corners (or two points) on the picture and say what they measure. */
export function UnderlaySetupDialog() {
  const target = useUnderlayUi((s) => s.setup);
  if (!target) return null;
  return <Inner key={target.imageUrl + (target.editId ?? '')} />;
}

function Inner() {
  const tt = useT();
  const target = useUnderlayUi((s) => s.setup)!;
  const close = useUnderlayUi((s) => s.closeSetup);
  const units = useModel((s) => s.project.units);
  const levelId = useModel((s) => s.activeLevelId);
  const [mode, setMode] = useState<Mode>(target.mode ?? 'corners');
  const [points, setPoints] = useState<Vec2[]>(target.points ?? []);
  const fmt = (m: number | undefined) => (m === undefined ? '' : formatLength(m, units, 3));
  const [width, setWidth] = useState(fmt(target.size?.[0]));
  const [depth, setDepth] = useState(fmt(target.size?.[1]));
  const [distance, setDistance] = useState(fmt(target.size?.[0]));
  const [ox, setOx] = useState(fmt(target.origin?.x ?? 0));
  const [oy, setOy] = useState(fmt(target.origin?.y ?? 0));
  const [busy, setBusy] = useState(false);
  const drag = useRef<number | null>(null);
  const svg = useRef<SVGSVGElement>(null);
  const need = mode === 'corners' ? 4 : 2;

  const toImage = (e: { clientX: number; clientY: number }): Vec2 => {
    const el = svg.current!;
    const r = el.getBoundingClientRect();
    return {
      x: Math.min(target.width, Math.max(0, ((e.clientX - r.left) / r.width) * target.width)),
      y: Math.min(target.height, Math.max(0, ((e.clientY - r.top) / r.height) * target.height)),
    };
  };

  const pick = (m: Mode) => {
    setMode(m);
    setPoints((p) => p.slice(0, m === 'corners' ? 4 : 2));
  };

  const accept = async () => {
    const o = { x: parseLength(ox, units) ?? 0, y: parseLength(oy, units) ?? 0 };
    let transform: Matrix3 | null;
    let size: number[];
    if (mode === 'corners') {
      const w = parseLength(width, units);
      const d = parseLength(depth, units);
      if (points.length !== 4 || !w || !d || w <= 0 || d <= 0) {
        toast(t('underlay.pickCorners'));
        return;
      }
      transform = rectifyFromCorners(points, w, d, o);
      size = [w, d];
    } else {
      const dist = parseLength(distance, units);
      if (points.length !== 2 || !dist || dist <= 0) {
        toast(t('underlay.pickTwo'));
        return;
      }
      transform = scaleFromTwoPoints(points[0]!, points[1]!, dist, o);
      size = [dist];
    }
    if (!transform) {
      toast(t('err.underlayMatrix'));
      return;
    }
    const setup = { mode, points, size, origin: o };
    setBusy(true);
    try {
      if (target.editId) {
        const id = target.editId;
        edit((p) => ops.updateUnderlay(p, id, { setup, transform: transform! }));
      } else {
        const source =
          target.source ??
          (await storeUnderlayImage(target.file!, target.name, {
            width: target.width,
            height: target.height,
          }));
        try {
          edit((p) => {
            ops.addUnderlay(p, {
              name: target.name,
              levelId,
              source,
              imageWidth: target.width,
              imageHeight: target.height,
              transform: transform!,
              setup,
            });
          });
        } catch (e) {
          await forgetLocalImage(source);
          throw e;
        }
      }
      close();
    } catch (e) {
      toast(e instanceof ModelError ? e.message : t('underlay.failed'));
    } finally {
      setBusy(false);
    }
  };

  const field = (label: string, value: string, set: (v: string) => void) => (
    <label className="flex flex-col gap-0.5 text-xs text-slate-600">
      {label}
      <input
        value={value}
        onChange={(e) => set(e.target.value)}
        className="rounded border border-slate-300 px-2 py-1 text-sm text-slate-800"
      />
    </label>
  );

  return (
    <Modal open onClose={close} label={tt('underlay.setupTitle')} className="max-w-3xl">
      <div className="flex flex-col gap-3 overflow-auto p-4" data-testid="underlay-setup">
        <h2 className="text-base font-semibold">{tt('underlay.setupTitle')}</h2>
        <div className="flex flex-wrap gap-2 text-sm">
          {(['corners', 'two-point'] as const).map((m) => (
            <button
              key={m}
              aria-pressed={mode === m}
              onClick={() => pick(m)}
              className={`rounded border px-2 py-1 ${mode === m ? 'border-sky-500 bg-sky-50 text-sky-700' : 'border-slate-300'}`}
            >
              {tt(m === 'corners' ? 'underlay.modeCorners' : 'underlay.modeTwo')}
            </button>
          ))}
        </div>
        <p className="text-xs text-slate-600">
          {tt(mode === 'corners' ? 'underlay.pickCorners' : 'underlay.pickTwo')}{' '}
          {tf('underlay.markers', { n: points.length, total: need })}
        </p>
        <div className="max-h-[50vh] overflow-auto rounded border border-slate-200 bg-slate-100">
          <svg
            ref={svg}
            viewBox={`0 0 ${target.width} ${target.height}`}
            className="mx-auto block max-h-[48vh] w-auto touch-none select-none"
            style={{ aspectRatio: `${target.width} / ${target.height}` }}
            data-testid="underlay-setup-picture"
            onPointerDown={(e) => {
              if (drag.current !== null || points.length >= need) return;
              setPoints((p) => [...p, toImage(e)]);
            }}
            onPointerMove={(e) => {
              if (drag.current === null) return;
              const i = drag.current;
              const at = toImage(e);
              setPoints((p) => p.map((q, k) => (k === i ? at : q)));
            }}
            onPointerUp={() => (drag.current = null)}
            onPointerLeave={() => (drag.current = null)}
          >
            <image href={target.imageUrl} width={target.width} height={target.height} />
            {mode === 'corners' && points.length > 1 && (
              <polygon
                points={points.map((p) => `${p.x},${p.y}`).join(' ')}
                fill={points.length === 4 ? 'rgba(14,165,233,0.15)' : 'none'}
                stroke="#0ea5e9"
                strokeWidth={target.width / 300}
              />
            )}
            {mode === 'two-point' && points.length === 2 && (
              <line
                x1={points[0]!.x}
                y1={points[0]!.y}
                x2={points[1]!.x}
                y2={points[1]!.y}
                stroke="#0ea5e9"
                strokeWidth={target.width / 300}
              />
            )}
            {points.map((p, i) => (
              <g
                key={i}
                data-testid={`underlay-marker-${i}`}
                onPointerDown={(e) => {
                  e.stopPropagation();
                  drag.current = i;
                  (e.currentTarget.ownerSVGElement as SVGSVGElement).setPointerCapture?.(
                    e.pointerId,
                  );
                }}
                style={{ cursor: 'grab' }}
              >
                <circle cx={p.x} cy={p.y} r={target.width / 70} fill="rgba(14,165,233,0.35)" />
                <circle cx={p.x} cy={p.y} r={target.width / 220} fill="#0369a1" />
                <text
                  x={p.x + target.width / 60}
                  y={p.y - target.width / 60}
                  fontSize={target.width / 35}
                  fill="#0c4a6e"
                  fontWeight="bold"
                >
                  {i + 1}
                </text>
              </g>
            ))}
          </svg>
        </div>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          {mode === 'corners' ? (
            <>
              {field(tt('underlay.width'), width, setWidth)}
              {field(tt('underlay.depth'), depth, setDepth)}
            </>
          ) : (
            field(tt('underlay.distance'), distance, setDistance)
          )}
          {field(tt('underlay.originX'), ox, setOx)}
          {field(tt('underlay.originY'), oy, setOy)}
        </div>
        <div className="flex justify-end gap-2">
          <button className="rounded border border-slate-300 px-3 py-1.5 text-sm" onClick={close}>
            {tt('underlay.cancel')}
          </button>
          <button
            data-testid="underlay-use"
            disabled={busy || points.length !== need}
            onClick={accept}
            className="rounded bg-sky-600 px-3 py-1.5 text-sm text-white disabled:opacity-40"
          >
            {tt('underlay.use')}
          </button>
        </div>
      </div>
    </Modal>
  );
}
