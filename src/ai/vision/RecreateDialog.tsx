import { useRef } from 'react';
import { type TranslationKey, t, tf, useT } from '../../i18n';
import { ROOM_TYPES, ZONE_TYPES } from '../../model/schemas';
import { useModel } from '../../model/store';
import { Modal } from '../../ui/Modal';
import { useRecreate } from './recreateStore';

const confidenceColor = (c: number) => (c >= 0.8 ? '#16a34a' : c >= 0.5 ? '#d97706' : '#dc2626');
const field = 'w-16 rounded border border-slate-300 px-1 py-0.5 text-xs';

/** Step 1: the picture, optional four corners and real size, and where to start. */
function Setup() {
  const tt = useT();
  const s = useRecreate();
  const svg = useRef<SVGSVGElement>(null);
  const drag = useRef<number | null>(null);
  const at = (e: { clientX: number; clientY: number }) => {
    const r = svg.current!.getBoundingClientRect();
    return {
      x: Math.min(s.width, Math.max(0, ((e.clientX - r.left) / r.width) * s.width)),
      y: Math.min(s.height, Math.max(0, ((e.clientY - r.top) / r.height) * s.height)),
    };
  };
  const dot = Math.max(s.width, s.height) / 90;
  return (
    <div className="flex flex-col gap-3 overflow-auto p-4">
      <h2 className="text-base font-semibold">{tt('vision.setupTitle')}</h2>
      <p className="text-xs text-slate-600">{tt('vision.cornersHint')}</p>
      <div className="max-h-[48vh] overflow-auto rounded border border-slate-200 bg-slate-100">
        <svg
          ref={svg}
          viewBox={`0 0 ${s.width} ${s.height}`}
          data-testid="recreate-picture"
          className="mx-auto block max-h-[46vh] w-auto touch-none select-none"
          style={{ aspectRatio: `${s.width} / ${s.height}` }}
          onPointerDown={(e) => {
            if (drag.current !== null || s.corners.length >= 4) return;
            s.setCorners([...s.corners, at(e)]);
          }}
          onPointerMove={(e) => {
            if (drag.current === null) return;
            const i = drag.current;
            const p = at(e);
            s.setCorners(s.corners.map((c, k) => (k === i ? p : c)));
          }}
          onPointerUp={() => (drag.current = null)}
          onPointerLeave={() => (drag.current = null)}
        >
          {s.imageUrl && <image href={s.imageUrl} width={s.width} height={s.height} />}
          {s.corners.length > 1 && (
            <polygon
              points={s.corners.map((p) => `${p.x},${p.y}`).join(' ')}
              fill={s.corners.length === 4 ? 'rgba(14,165,233,0.15)' : 'none'}
              stroke="#0ea5e9"
              strokeWidth={dot / 3}
            />
          )}
          {s.corners.map((p, i) => (
            <g
              key={i}
              data-testid={`recreate-corner-${i}`}
              style={{ cursor: 'grab' }}
              onPointerDown={(e) => {
                e.stopPropagation();
                drag.current = i;
                (e.currentTarget.ownerSVGElement as SVGSVGElement).setPointerCapture?.(e.pointerId);
              }}
            >
              <circle cx={p.x} cy={p.y} r={dot} fill="rgba(14,165,233,0.35)" />
              <circle cx={p.x} cy={p.y} r={dot / 3} fill="#0369a1" />
              <text x={p.x + dot} y={p.y - dot} fontSize={dot * 2} fill="#0c4a6e" fontWeight="bold">
                {i + 1}
              </text>
            </g>
          ))}
        </svg>
      </div>
      <div className="flex flex-wrap items-end gap-3 text-xs text-slate-600">
        <label className="flex flex-col gap-0.5">
          {tt('vision.realWidth')}
          <input
            className="w-24 rounded border border-slate-300 px-2 py-1 text-sm text-slate-800"
            value={s.realWidth}
            inputMode="decimal"
            onChange={(e) => s.setReal(e.target.value, s.realDepth)}
          />
        </label>
        <label className="flex flex-col gap-0.5">
          {tt('vision.realDepth')}
          <input
            className="w-24 rounded border border-slate-300 px-2 py-1 text-sm text-slate-800"
            value={s.realDepth}
            inputMode="decimal"
            onChange={(e) => s.setReal(s.realWidth, e.target.value)}
          />
        </label>
        <button
          className="rounded border border-slate-300 px-2 py-1"
          onClick={() => s.setCorners([])}
        >
          {tt('vision.clearCorners')}
        </button>
        <label className="flex items-center gap-1">
          <input
            type="checkbox"
            checked={s.withItems}
            onChange={(e) => s.setWithItems(e.target.checked)}
          />
          {tt('vision.furniture')}
        </label>
      </div>
      {s.error && (
        <p role="alert" className="rounded bg-red-50 p-2 text-xs text-red-700">
          {s.error}
        </p>
      )}
      <div className="flex flex-wrap justify-end gap-2">
        <button className="rounded border border-slate-300 px-3 py-1.5 text-sm" onClick={s.close}>
          {tt('vision.cancel')}
        </button>
        <button
          data-testid="recreate-read-corners"
          disabled={s.corners.length !== 4}
          className="rounded border border-sky-600 px-3 py-1.5 text-sm text-sky-700 disabled:opacity-40"
          onClick={() => void s.read(false)}
        >
          {tt('vision.readCorners')}
        </button>
        <button
          data-testid="recreate-read-auto"
          className="rounded bg-sky-600 px-3 py-1.5 text-sm text-white"
          onClick={() => void s.read(true)}
        >
          {tt('vision.readAuto')}
        </button>
      </div>
    </div>
  );
}

function Reading() {
  const tt = useT();
  const { progress, cancel } = useRecreate();
  const key = `vision.progress.${progress?.phase ?? 'locating'}` as TranslationKey;
  return (
    <div className="flex flex-col items-center gap-3 p-8" role="status">
      <span className="h-6 w-6 animate-spin rounded-full border-2 border-sky-500 border-t-transparent" />
      <p data-testid="recreate-progress" className="text-sm">
        {tf(key, { done: progress?.done ?? 0, total: progress?.total ?? 1 })}
      </p>
      <button className="rounded border border-slate-300 px-3 py-1 text-sm" onClick={cancel}>
        {tt('vision.cancel')}
      </button>
    </div>
  );
}

/** Step 3: the rooms found, over the straightened picture, to correct before anything is built. */
function Review() {
  const tt = useT();
  const s = useRecreate();
  const hasWalls = useModel((m) => m.project.walls.length > 0);
  const f = s.ftPerPx;
  const w = s.rectified?.canvas.width ?? 1;
  const h = s.rectified?.canvas.height ?? 1;
  const bad = s.rooms.filter((r) => r.confidence < 0.5).length;
  return (
    <div className="flex min-h-0 flex-col gap-3 overflow-auto p-4">
      <h2 className="text-base font-semibold">{tt('vision.reviewTitle')}</h2>
      <p className="text-xs text-slate-600">{tt('vision.reviewHint')}</p>
      <div className="grid min-h-0 gap-3 md:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)]">
        <div className="max-h-[55vh] overflow-auto rounded border border-slate-200 bg-slate-100">
          <svg
            viewBox={`0 0 ${w} ${h}`}
            data-testid="recreate-review-picture"
            className="mx-auto block max-h-[54vh] w-auto"
            style={{ aspectRatio: `${w} / ${h}` }}
          >
            {s.rectifiedUrl && <image href={s.rectifiedUrl} width={w} height={h} />}
            {s.rooms.map((r) => {
              const x = r.rect[0] / f;
              const y = r.rect[1] / f;
              const rw = r.rect[2] / f;
              const rh = r.rect[3] / f;
              const sel = s.selected === r.id;
              return (
                <g
                  key={r.id}
                  onClick={() => s.select(r.id)}
                  style={{ cursor: 'pointer' }}
                  data-testid="recreate-box"
                >
                  <rect
                    x={x}
                    y={y}
                    width={rw}
                    height={rh}
                    fill={confidenceColor(r.confidence)}
                    fillOpacity={sel ? 0.3 : 0.14}
                    stroke={confidenceColor(r.confidence)}
                    strokeWidth={sel ? w / 180 : w / 400}
                    strokeDasharray={r.kind === 'zone' ? `${w / 120} ${w / 200}` : undefined}
                  />
                  <text
                    x={x + rw / 2}
                    y={y + rh / 2}
                    fontSize={Math.max(w / 70, 9)}
                    textAnchor="middle"
                    fill="#0f172a"
                    stroke="#fff"
                    strokeWidth={w / 700}
                    paintOrder="stroke"
                  >
                    {r.name}
                  </text>
                </g>
              );
            })}
          </svg>
        </div>
        <div className="max-h-[55vh] overflow-auto">
          <table className="w-full text-xs" data-testid="recreate-rooms">
            <thead>
              <tr className="text-left text-slate-500">
                <th>{tt('vision.col.name')}</th>
                <th>{tt('vision.col.type')}</th>
                <th>{tt('vision.col.x')}</th>
                <th>{tt('vision.col.y')}</th>
                <th>{tt('vision.col.width')}</th>
                <th>{tt('vision.col.depth')}</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {s.rooms.map((r) => (
                <tr
                  key={r.id}
                  className={s.selected === r.id ? 'bg-sky-50' : ''}
                  onClick={() => s.select(r.id)}
                  data-testid="recreate-room"
                >
                  <td>
                    <span
                      className="mr-1 inline-block h-2 w-2 rounded-full"
                      style={{ background: confidenceColor(r.confidence) }}
                      title={`${Math.round(r.confidence * 100)} %`}
                    />
                    <input
                      aria-label={tt('vision.col.name')}
                      className="w-28 rounded border border-slate-300 px-1 py-0.5"
                      value={r.name}
                      onChange={(e) => s.update(r.id, { name: e.target.value })}
                    />
                  </td>
                  <td>
                    <select
                      aria-label={tt('vision.col.type')}
                      className="rounded border border-slate-300 px-1 py-0.5"
                      value={r.type}
                      onChange={(e) =>
                        s.update(r.id, {
                          type: e.target.value,
                          kind: (ZONE_TYPES as readonly string[]).includes(e.target.value)
                            ? 'zone'
                            : 'room',
                        })
                      }
                    >
                      <optgroup label={tt('vision.rooms')}>
                        {ROOM_TYPES.map((x) => (
                          <option key={x} value={x}>
                            {x}
                          </option>
                        ))}
                      </optgroup>
                      <optgroup label={tt('vision.areas')}>
                        {ZONE_TYPES.map((x) => (
                          <option key={x} value={x}>
                            {x}
                          </option>
                        ))}
                      </optgroup>
                    </select>
                  </td>
                  {[0, 1, 2, 3].map((k) => (
                    <td key={k}>
                      <input
                        type="number"
                        step={0.25}
                        min={k > 1 ? 1 : undefined}
                        aria-label={tt(
                          (
                            [
                              'vision.col.x',
                              'vision.col.y',
                              'vision.col.width',
                              'vision.col.depth',
                            ] as const
                          )[k]!,
                        )}
                        className={field}
                        value={Math.round(r.rect[k]! * 100) / 100}
                        onChange={(e) => {
                          const v = Number(e.target.value);
                          if (!Number.isFinite(v)) return;
                          const next = [...r.rect] as typeof r.rect;
                          next[k] = k > 1 ? Math.max(1, v) : v;
                          s.update(r.id, { rect: next });
                        }}
                      />
                    </td>
                  ))}
                  <td>
                    <button
                      className="rounded px-1 text-red-700 hover:bg-red-50"
                      aria-label={`${tt('vision.delete')} ${r.name}`}
                      onClick={() => s.remove(r.id)}
                    >
                      ✕
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <button
            className="mt-2 rounded border border-slate-300 px-2 py-1 text-xs"
            onClick={s.addRoom}
          >
            + {tt('vision.add')}
          </button>
        </div>
      </div>
      {bad > 0 && <p className="text-xs text-amber-800">{tf('vision.doubtful', { n: bad })}</p>}
      {s.notes.length > 0 && (
        <details className="text-xs text-slate-600">
          <summary className="cursor-pointer">
            {tt('vision.notes')} ({s.notes.length})
          </summary>
          <ul className="list-inside list-disc">
            {s.notes.map((n, i) => (
              <li key={i}>{n}</li>
            ))}
          </ul>
        </details>
      )}
      {hasWalls && <p className="text-xs text-slate-500">{t('vision.replaces')}</p>}
      {s.error && (
        <p role="alert" className="rounded bg-red-50 p-2 text-xs text-red-700">
          {s.error}
        </p>
      )}
      <div className="flex flex-wrap justify-end gap-2">
        <button className="rounded border border-slate-300 px-3 py-1.5 text-sm" onClick={s.close}>
          {tt('vision.cancel')}
        </button>
        <button
          data-testid="recreate-build-labelled"
          className="rounded border border-sky-600 px-3 py-1.5 text-sm text-sky-700"
          onClick={() => void s.build('labelled')}
          disabled={!s.rooms.length}
        >
          {tt('vision.buildLabelled')}
        </button>
        <button
          data-testid="recreate-build-pictured"
          className="rounded border border-sky-600 px-3 py-1.5 text-sm text-sky-700"
          onClick={() => void s.build('pictured')}
          disabled={!s.rooms.length}
        >
          {tt('vision.buildPictured')}
        </button>
        <button
          data-testid="recreate-build-both"
          className="rounded border border-sky-600 px-3 py-1.5 text-sm text-sky-700"
          onClick={() => void s.build('both')}
          disabled={!s.rooms.length}
        >
          {tt('vision.buildBoth')}
        </button>
        <button
          data-testid="recreate-build-exact"
          className="rounded bg-sky-600 px-3 py-1.5 text-sm text-white disabled:opacity-40"
          onClick={() => void s.build('exact')}
          disabled={!s.rooms.length}
        >
          {tt('vision.buildExact')}
        </button>
      </div>
    </div>
  );
}

/** The "Recreate from picture" dialog (mounted once in the app). */
export function RecreateDialog() {
  const tt = useT();
  const step = useRecreate((s) => s.step);
  const close = useRecreate((s) => s.close);
  if (step === 'closed') return null;
  return (
    <Modal open onClose={close} label={tt('vision.setupTitle')} className="max-w-5xl">
      <div data-testid="recreate-dialog" className="flex min-h-0 flex-col">
        {step === 'setup' && <Setup />}
        {step === 'reading' && <Reading />}
        {step === 'review' && <Review />}
      </div>
    </Modal>
  );
}
