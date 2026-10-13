import { X } from 'lucide-react';
import { useMemo, useState } from 'react';
import { fmtNum, useT } from '../i18n';
import { useModel } from '../model/store';
import { saveProject } from '../persistence/repo';
import { TEMPLATES, VILLA_TEMPLATE } from '../templates';
import { Modal } from '../ui/Modal';
import { useUiStore } from '../ui/uiStore';
import { projectWithTemplate } from './finish';
import {
  type ShellConfig,
  defaultConfig,
  footprintOf,
  newId,
  planHeights,
  projectFromConfig,
  snapToOutline,
  validateFootprint,
} from './shell';

const field = 'w-20 rounded border border-slate-300 px-1 py-0.5 text-sm';
const btn = 'rounded-md border border-slate-300 px-3 py-1 text-sm hover:bg-slate-100';
const primary =
  'rounded-md bg-slate-800 px-3 py-1 text-sm text-white hover:bg-slate-700 disabled:opacity-40';

function Num({
  label,
  value,
  onChange,
  step = 0.1,
}: {
  label: string;
  value: number;
  onChange: (v: number) => void;
  step?: number;
}) {
  return (
    <label className="flex items-center justify-between gap-2 text-sm">
      {label}
      <input
        type="number"
        step={step}
        className={field}
        value={Number.isFinite(value) ? value : ''}
        onChange={(e) => onChange(parseFloat(e.target.value))}
      />
    </label>
  );
}

const parsePoints = (text: string) =>
  text
    .split('\n')
    .map((l) =>
      l
        .split(/[ ,;]+/)
        .filter(Boolean)
        .map(Number),
    )
    .filter((p) => p.length >= 2 && p.every(Number.isFinite))
    .map(([x, y]) => ({ x: x!, y: y! }));

export function ShellWizard() {
  const t = useT();
  const open = useUiStore((s) => s.wizardOpen);
  const setOpen = useUiStore((s) => s.setWizardOpen);
  const [step, setStep] = useState(1);
  const [c, setC] = useState<ShellConfig>(defaultConfig);
  const [customText, setCustomText] = useState('0, 0\n10, 0\n10, 12\n0, 12');
  const set = (patch: Partial<ShellConfig>) => setC((x) => ({ ...x, ...patch }));

  const config = useMemo<ShellConfig>(
    () => (c.shape === 'custom' ? { ...c, custom: parsePoints(customText) } : c),
    [c, customText],
  );
  const poly = useMemo(() => footprintOf(config), [config]);
  const errors = useMemo(() => {
    const list = validateFootprint(poly);
    if (c.kind === 'villa' && poly.length >= 3) {
      const xs = poly.map((q) => q.x);
      const ys = poly.map((q) => q.y);
      const w = Math.max(...xs) - Math.min(...xs);
      const d = Math.max(...ys) - Math.min(...ys);
      if (w + 3 > c.plotW || d + 3 > c.plotD) list.push(t('wiz.err.plot'));
    }
    return list;
  }, [poly, c.kind, c.plotW, c.plotD, t]);
  const heights = planHeights(c.totalHeight, c.groundHeight);

  if (!open) return null;

  const finish = async (choice: 'empty' | 'ai' | string) => {
    let project = projectFromConfig(config);
    if (choice !== 'empty' && choice !== 'ai') {
      const tpl = [...TEMPLATES, VILLA_TEMPLATE].find((x) => x.id === choice);
      if (tpl) project = projectWithTemplate(project, tpl);
    }
    await saveProject(useModel.getState().project);
    useModel.getState().loadProject(project);
    await saveProject(project);
    if (choice === 'ai') useUiStore.getState().setLeftTab('ai');
    setOpen(false);
    setStep(1);
    setC(defaultConfig());
  };

  const edgePoint = (edge: number, offset: number) => {
    const a = poly[edge % poly.length]!;
    const b = poly[(edge + 1) % poly.length]!;
    const len = Math.hypot(b.x - a.x, b.y - a.y) || 1;
    return { x: a.x + ((b.x - a.x) / len) * offset, y: a.y + ((b.y - a.y) / len) * offset };
  };

  const canNext =
    step === 1 ? errors.length === 0 : step === 2 ? c.kind === 'villa' || heights.ok : true;

  return (
    <Modal
      open
      onClose={() => setOpen(false)}
      label={t(c.kind === 'villa' ? 'wiz.titleVilla' : 'wiz.title')}
      className="max-w-xl"
      placement="sheet"
    >
      <>
        <div className="flex items-center border-b border-slate-200 px-4 py-3">
          <h2 className="flex-1 font-semibold">
            {t(c.kind === 'villa' ? 'wiz.titleVilla' : 'wiz.title')} — {step}/4{' '}
            {[t('wiz.step1'), t('wiz.step2'), t('wiz.step3'), t('wiz.step4')][step - 1]}
          </h2>
          <button
            aria-label={t('wiz.cancel')}
            className="rounded p-1 hover:bg-slate-100"
            onClick={() => setOpen(false)}
          >
            <X size={16} />
          </button>
        </div>
        <div className="min-h-0 flex-1 space-y-3 overflow-auto p-4">
          {step === 1 && (
            <>
              <label className="flex items-center justify-between gap-2 text-sm">
                {t('wiz.name')}
                <input
                  className="w-48 rounded border border-slate-300 px-1 py-0.5"
                  value={c.name}
                  onChange={(e) => set({ name: e.target.value })}
                />
              </label>
              <div className="flex gap-2" role="radiogroup" aria-label={t('wiz.kind')}>
                {(['apartment', 'villa'] as const).map((k) => (
                  <button
                    key={k}
                    role="radio"
                    aria-checked={c.kind === k}
                    data-testid={`kind-${k}`}
                    className={`${btn} ${c.kind === k ? 'bg-slate-200' : ''}`}
                    onClick={() =>
                      set(
                        k === 'villa'
                          ? { kind: k, name: c.name === 'My Duplex Home' ? 'My Villa' : c.name }
                          : { kind: k, name: c.name === 'My Villa' ? 'My Duplex Home' : c.name },
                      )
                    }
                  >
                    {k === 'villa' ? t('wiz.villa') : t('wiz.apartment')}
                  </button>
                ))}
              </div>
              {c.kind === 'villa' && (
                <>
                  <Num label={t('wiz.plotW')} value={c.plotW} onChange={(v) => set({ plotW: v })} />
                  <Num label={t('wiz.plotD')} value={c.plotD} onChange={(v) => set({ plotD: v })} />
                  <p className="text-xs text-slate-500">{t('wiz.plotHelp')}</p>
                </>
              )}
              <div className="flex gap-2" role="radiogroup">
                {(['rectangle', 'L', 'U', 'custom'] as const).map((k) => (
                  <button
                    key={k}
                    role="radio"
                    aria-checked={c.shape === k}
                    className={`${btn} ${c.shape === k ? 'bg-slate-200' : ''}`}
                    onClick={() => set({ shape: k })}
                  >
                    {k === 'rectangle'
                      ? t('wiz.rect')
                      : k === 'L'
                        ? t('wiz.L')
                        : k === 'U'
                          ? t('wiz.U')
                          : t('wiz.custom')}
                  </button>
                ))}
              </div>
              {c.shape !== 'custom' && (
                <>
                  <Num label={t('wiz.width')} value={c.width} onChange={(v) => set({ width: v })} />
                  <Num label={t('wiz.depth')} value={c.depth} onChange={(v) => set({ depth: v })} />
                </>
              )}
              {(c.shape === 'L' || c.shape === 'U') && (
                <>
                  <Num
                    label={t('wiz.notchW')}
                    value={c.notchW}
                    onChange={(v) => set({ notchW: v })}
                  />
                  <Num
                    label={t('wiz.notchD')}
                    value={c.notchD}
                    onChange={(v) => set({ notchD: v })}
                  />
                  {c.shape === 'L' && (
                    <label className="flex items-center justify-between text-sm">
                      {t('wiz.corner')}
                      <select
                        className="rounded border border-slate-300 px-1 py-0.5"
                        value={c.notchCorner}
                        onChange={(e) =>
                          set({ notchCorner: e.target.value as ShellConfig['notchCorner'] })
                        }
                      >
                        {['ne', 'nw', 'se', 'sw'].map((k) => (
                          <option key={k}>{k}</option>
                        ))}
                      </select>
                    </label>
                  )}
                </>
              )}
              {c.shape === 'custom' && (
                <div>
                  <p className="text-xs text-slate-500">{t('wiz.customHelp')}</p>
                  <textarea
                    className="mt-1 h-28 w-full rounded border border-slate-300 p-1 font-mono text-sm"
                    value={customText}
                    onChange={(e) => setCustomText(e.target.value)}
                  />
                </div>
              )}
              {errors.map((e) => (
                <p key={e} role="alert" className="text-sm text-red-600">
                  {e}
                </p>
              ))}
            </>
          )}
          {step === 2 && c.kind === 'villa' && (
            <>
              <label className="flex items-center justify-between text-sm">
                {t('wiz.storeys')}
                <select
                  className="rounded border border-slate-300 px-1 py-0.5"
                  data-testid="wiz-storeys"
                  value={c.storeys}
                  onChange={(e) => set({ storeys: Number(e.target.value) })}
                >
                  {[1, 2, 3].map((n) => (
                    <option key={n} value={n}>
                      {n}
                    </option>
                  ))}
                </select>
              </label>
              <Num
                label={t('wiz.ceiling')}
                value={c.groundHeight}
                onChange={(v) => set({ groundHeight: v })}
              />
              {c.groundHeight < 2.4 && (
                <p role="alert" className="text-sm text-amber-700">
                  {t('wiz.warn.ground').replace('{h}', fmtNum(c.groundHeight, 2))}
                </p>
              )}
            </>
          )}
          {step === 2 && c.kind !== 'villa' && (
            <>
              <Num
                label={t('wiz.total')}
                value={c.totalHeight}
                onChange={(v) => set({ totalHeight: v })}
              />
              <Num
                label={t('wiz.ground')}
                value={c.groundHeight}
                onChange={(v) => set({ groundHeight: v })}
              />
              <p className="text-sm">
                {t('wiz.upperResult').replace('{h}', fmtNum(heights.upper, 2))}
              </p>
              {heights.warnings.map((w) => (
                <p key={w} role="alert" className="text-sm text-amber-700">
                  {w}
                </p>
              ))}
            </>
          )}
          {step === 3 && (
            <>
              <section>
                <h3 className="text-sm font-medium">{t('wiz.columns')}</h3>
                {c.columns.map((col, i) => (
                  <div key={i} className="flex items-center gap-1 text-sm">
                    <input
                      className={field}
                      aria-label={`${t('wiz.columns')} x`}
                      type="number"
                      step={0.1}
                      value={col.position.x}
                      onChange={(e) =>
                        set({
                          columns: c.columns.map((k, j) =>
                            j === i ? { ...k, position: { ...k.position, x: +e.target.value } } : k,
                          ),
                        })
                      }
                    />
                    <input
                      className={field}
                      aria-label={`${t('wiz.columns')} y`}
                      type="number"
                      step={0.1}
                      value={col.position.y}
                      onChange={(e) =>
                        set({
                          columns: c.columns.map((k, j) =>
                            j === i ? { ...k, position: { ...k.position, y: +e.target.value } } : k,
                          ),
                        })
                      }
                    />
                    <input
                      className={field}
                      aria-label={t('wiz.size')}
                      type="number"
                      step={0.05}
                      value={col.size}
                      onChange={(e) =>
                        set({
                          columns: c.columns.map((k, j) =>
                            j === i ? { ...k, size: +e.target.value } : k,
                          ),
                        })
                      }
                    />
                    <button
                      className={btn}
                      onClick={() => set({ columns: c.columns.filter((_, j) => j !== i) })}
                    >
                      {t('wiz.remove')}
                    </button>
                  </div>
                ))}
                <button
                  className={btn}
                  onClick={() =>
                    set({ columns: [...c.columns, { position: { x: 5, y: 6 }, size: 0.3 }] })
                  }
                >
                  {t('wiz.add')} {t('wiz.columns')}
                </button>
              </section>
              <section>
                <h3 className="text-sm font-medium">{t('wiz.beams')}</h3>
                {c.beams.map((b, i) => (
                  <div key={b.id} className="flex flex-wrap items-center gap-1 text-sm">
                    <input
                      className="w-24 rounded border border-slate-300 px-1"
                      aria-label={t('wiz.beam.from')}
                      placeholder={t('wiz.ph')}
                      defaultValue={`${b.start.x}, ${b.start.y}`}
                      onBlur={(e) => {
                        const [p] = parsePoints(e.target.value);
                        if (p)
                          set({ beams: c.beams.map((k, j) => (j === i ? { ...k, start: p } : k)) });
                      }}
                    />
                    <input
                      className="w-24 rounded border border-slate-300 px-1"
                      aria-label={t('wiz.beam.to')}
                      placeholder={t('wiz.ph')}
                      defaultValue={`${b.end.x}, ${b.end.y}`}
                      onBlur={(e) => {
                        const [p] = parsePoints(e.target.value);
                        if (p)
                          set({ beams: c.beams.map((k, j) => (j === i ? { ...k, end: p } : k)) });
                      }}
                    />
                    <select
                      className="rounded border border-slate-300 px-1"
                      aria-label={t('wiz.beam.drop')}
                      value={b.drop}
                      onChange={(e) =>
                        set({
                          beams: c.beams.map((k, j) =>
                            j === i ? { ...k, drop: +e.target.value } : k,
                          ),
                        })
                      }
                    >
                      {[0.2, 0.3, 0.4, 0.5, 0.6].map((d) => (
                        <option key={d} value={d}>
                          {fmtNum(d, 1)} {t('unit.m')}
                        </option>
                      ))}
                    </select>
                    <button
                      className={btn}
                      onClick={() => set({ beams: c.beams.filter((_, j) => j !== i) })}
                    >
                      {t('wiz.remove')}
                    </button>
                  </div>
                ))}
                <button
                  className={btn}
                  onClick={() =>
                    set({
                      beams: [
                        ...c.beams,
                        {
                          id: newId(),
                          start: { x: 0, y: 6 },
                          end: { x: c.width, y: 6 },
                          width: 0.25,
                          drop: 0.4,
                        },
                      ],
                    })
                  }
                >
                  {t('wiz.add')} {t('wiz.beams')}
                </button>
              </section>
              <section>
                <h3 className="text-sm font-medium">{t('wiz.entrance')}</h3>
                <EdgePicker
                  poly={poly}
                  onPick={(edge, offset) => {
                    const s = snapToOutline(poly, edgePoint(edge, offset));
                    set({ entrance: { position: s.point, direction: s.direction } });
                  }}
                />
              </section>
              <section>
                <h3 className="text-sm font-medium">{t('wiz.plumbing')}</h3>
                {c.plumbing.map((p, i) => (
                  <div key={i} className="flex items-center gap-1 text-sm">
                    <input
                      className={field}
                      type="number"
                      step={0.1}
                      aria-label={`${t('wiz.plumbing')} x`}
                      value={p.x}
                      onChange={(e) =>
                        set({
                          plumbing: c.plumbing.map((k, j) =>
                            j === i ? { ...k, x: +e.target.value } : k,
                          ),
                        })
                      }
                    />
                    <input
                      className={field}
                      type="number"
                      step={0.1}
                      aria-label={`${t('wiz.plumbing')} y`}
                      value={p.y}
                      onChange={(e) =>
                        set({
                          plumbing: c.plumbing.map((k, j) =>
                            j === i ? { ...k, y: +e.target.value } : k,
                          ),
                        })
                      }
                    />
                    <button
                      className={btn}
                      onClick={() => set({ plumbing: c.plumbing.filter((_, j) => j !== i) })}
                    >
                      {t('wiz.remove')}
                    </button>
                  </div>
                ))}
                <button
                  className={btn}
                  onClick={() => set({ plumbing: [...c.plumbing, { x: 1, y: 1 }] })}
                >
                  {t('wiz.add')} {t('wiz.plumbing')}
                </button>
              </section>
              <section>
                <h3 className="text-sm font-medium">{t('wiz.windows')}</h3>
                {c.windows.map((w, i) => (
                  <div key={w.id} className="flex flex-wrap items-center gap-1 text-sm">
                    <input
                      className="w-14 rounded border border-slate-300 px-1"
                      type="number"
                      aria-label={t('wiz.edge')}
                      value={w.edge}
                      min={0}
                      max={poly.length - 1}
                      onChange={(e) =>
                        set({
                          windows: c.windows.map((k, j) =>
                            j === i ? { ...k, edge: +e.target.value } : k,
                          ),
                        })
                      }
                    />
                    <input
                      className={field}
                      type="number"
                      step={0.1}
                      aria-label={t('wiz.offset')}
                      value={w.offset}
                      onChange={(e) =>
                        set({
                          windows: c.windows.map((k, j) =>
                            j === i ? { ...k, offset: +e.target.value } : k,
                          ),
                        })
                      }
                    />
                    <input
                      className={field}
                      type="number"
                      step={0.1}
                      aria-label={t('wiz.win.width')}
                      value={w.width}
                      onChange={(e) =>
                        set({
                          windows: c.windows.map((k, j) =>
                            j === i ? { ...k, width: +e.target.value } : k,
                          ),
                        })
                      }
                    />
                    <input
                      className={field}
                      type="number"
                      step={0.1}
                      aria-label={t('wiz.win.sill')}
                      value={w.sillHeight}
                      onChange={(e) =>
                        set({
                          windows: c.windows.map((k, j) =>
                            j === i ? { ...k, sillHeight: +e.target.value } : k,
                          ),
                        })
                      }
                    />
                    <button
                      className={btn}
                      onClick={() => set({ windows: c.windows.filter((_, j) => j !== i) })}
                    >
                      {t('wiz.remove')}
                    </button>
                  </div>
                ))}
                <button
                  className={btn}
                  onClick={() =>
                    set({
                      windows: [
                        ...c.windows,
                        {
                          id: newId(),
                          edge: 0,
                          offset: 3,
                          width: 1.2,
                          height: 1.2,
                          sillHeight: 0.9,
                        },
                      ],
                    })
                  }
                >
                  {t('wiz.add')} {t('wiz.windows')}
                </button>
              </section>
            </>
          )}
          {step === 4 && (
            <div className="grid gap-2 sm:grid-cols-2">
              <button className={`${btn} text-left`} onClick={() => void finish('empty')}>
                <b>{t('wiz.empty')}</b>
                <div className="text-xs text-slate-500">{t('wiz.emptyDesc')}</div>
              </button>
              <button className={`${btn} text-left`} onClick={() => void finish('ai')}>
                <b>{t('wiz.ai')}</b>
                <div className="text-xs text-slate-500">{t('wiz.aiDesc')}</div>
              </button>
              {(c.kind === 'villa' ? [VILLA_TEMPLATE] : TEMPLATES).map((tp) => (
                <button
                  key={tp.id}
                  className={`${btn} text-left`}
                  data-testid={`tpl-${tp.id}`}
                  onClick={() => void finish(tp.id)}
                >
                  <b>{t(tp.nameKey)}</b>
                  <div className="text-xs text-slate-500">{t(tp.descKey)}</div>
                </button>
              ))}
            </div>
          )}
        </div>
        <div className="flex justify-between border-t border-slate-200 px-4 py-3">
          <button className={btn} onClick={() => (step === 1 ? setOpen(false) : setStep(step - 1))}>
            {step === 1 ? t('wiz.cancel') : t('wiz.back')}
          </button>
          {step < 4 && (
            <button className={primary} disabled={!canNext} onClick={() => setStep(step + 1)}>
              {t('wiz.next')}
            </button>
          )}
        </div>
      </>
    </Modal>
  );
}

function EdgePicker({
  poly,
  onPick,
}: {
  poly: { x: number; y: number }[];
  onPick: (edge: number, offset: number) => void;
}) {
  const t = useT();
  const [edge, setEdge] = useState(0);
  const [offset, setOffset] = useState(1);
  return (
    <div className="flex items-center gap-1 text-sm">
      <input
        className="w-14 rounded border border-slate-300 px-1"
        type="number"
        aria-label={t('wiz.edge')}
        min={0}
        max={poly.length - 1}
        value={edge}
        onChange={(e) => {
          setEdge(+e.target.value);
          onPick(+e.target.value, offset);
        }}
      />
      <input
        className={field}
        type="number"
        step={0.1}
        aria-label={t('wiz.offset')}
        value={offset}
        onChange={(e) => {
          setOffset(+e.target.value);
          onPick(edge, +e.target.value);
        }}
      />
    </div>
  );
}
