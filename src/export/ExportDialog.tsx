import { Download, X } from 'lucide-react';
import { type ReactNode, useMemo, useState } from 'react';
import { useT } from '../i18n';
import { exportProjectJson } from '../model/io';
import { setCurrency, setUnitCost } from '../model/ops';
import { useModel } from '../model/store';
import { useUiStore } from '../ui/uiStore';
import { BOM_CATEGORIES, CURRENCIES, bomCsv, priceBom } from './bom';
import { type CaptureOptions, captureScene } from './bridge';
import { downloadBlob, safeFileName } from './download';
import { planDxf } from './dxf';
import { exportGlb, exportObj } from './model3d';
import { type Paper, buildPdf } from './pdf';
import { type PlanScale, planSvg } from './planSvg';
import { captureHero, withScene } from './scene';
import { buildSnapshotHtml, fetchViewerBundle } from './snapshot';

type Tab = 'images' | 'pdf' | 'model' | 'plans' | 'costs' | 'share';
const TABS: Tab[] = ['images', 'pdf', 'model', 'plans', 'costs', 'share'];

const btn =
  'inline-flex items-center gap-1 rounded-md bg-slate-800 px-3 py-1.5 text-sm text-white hover:bg-slate-700 disabled:opacity-50';
const field = 'rounded border border-slate-300 px-1.5 py-0.5 text-sm';

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
      <span>{label}</span>
      <div className="flex flex-wrap items-center gap-2">{children}</div>
    </div>
  );
}

/** Runs an export with a busy flag and a readable error. */
function useTask() {
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const run = async (name: string, fn: () => Promise<string | void>) => {
    setBusy(name);
    setError(null);
    setDone(null);
    try {
      const msg = await fn();
      if (msg) setDone(msg);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  };
  return { busy, error, done, run };
}

export function ExportDialog() {
  const t = useT();
  const open = useUiStore((s) => s.exportOpen);
  const setOpen = useUiStore((s) => s.setExportOpen);
  const project = useModel((s) => s.project);
  const [tab, setTab] = useState<Tab>('images');
  const task = useTask();

  // Images
  const [imgScale, setImgScale] = useState<1 | 2 | 4>(2);
  const [imgFormat, setImgFormat] = useState<'png' | 'jpeg'>('png');
  const [transparent, setTransparent] = useState(false);
  const [presentation, setPresentation] = useState(true);
  // PDF
  const [pdfScale, setPdfScale] = useState<PlanScale>(50);
  const [paper, setPaper] = useState<Paper>('auto');
  const [pdfLevels, setPdfLevels] = useState<string[] | null>(null);
  const [furniture, setFurniture] = useState(true);
  const [cover, setCover] = useState(true);
  // 3D + plans
  const [levelId, setLevelId] = useState<string>('all');
  const [planLevel, setPlanLevel] = useState<string>('');
  const [svgScale, setSvgScale] = useState<PlanScale>(50);

  const base = safeFileName(project.name);
  const levels = useMemo(
    () => [...project.levels].sort((a, b) => a.index - b.index),
    [project.levels],
  );
  const planLevelId = planLevel || levels[0]?.id || '';
  const bom = useMemo(() => priceBom(project), [project]);

  if (!open) return null;
  const chosenPdfLevels = pdfLevels ?? levels.map((l) => l.id);

  const image = () =>
    task.run('image', async () => {
      const opts: CaptureOptions = {
        scale: imgScale,
        format: imgFormat,
        transparent,
        presentation,
      };
      const r = await withScene(() => captureScene(opts));
      downloadBlob(r.blob, `${base}.${imgFormat === 'png' ? 'png' : 'jpg'}`);
      return `${r.width} × ${r.height} px`;
    });

  const pdf = () =>
    task.run('pdf', async () => {
      const hero = cover ? await captureHero(project).catch(() => undefined) : undefined;
      const r = await buildPdf(project, {
        scale: pdfScale,
        paper,
        hero,
        levelIds: chosenPdfLevels,
        furniture,
      });
      downloadBlob(new Blob([r.data], { type: 'application/pdf' }), `${base}-plans.pdf`);
      return `${r.pages} ${t('export.pages')}`;
    });

  const glb = () =>
    task.run('glb', async () => {
      const data = await exportGlb(project, { levelId: levelId === 'all' ? undefined : levelId });
      downloadBlob(new Blob([data], { type: 'model/gltf-binary' }), `${base}.glb`);
    });

  const obj = () =>
    task.run('obj', async () => {
      const r = exportObj(project, { levelId: levelId === 'all' ? undefined : levelId });
      downloadBlob(new Blob([r.obj], { type: 'text/plain' }), `${base}.obj`);
      downloadBlob(new Blob([r.mtl], { type: 'text/plain' }), r.mtlName);
      return t('export.objNote');
    });

  const level = levels.find((l) => l.id === planLevelId);
  const svg = () =>
    task.run('svg', async () => {
      const p = planSvg(project, planLevelId, { scale: svgScale });
      downloadBlob(
        new Blob([p.svg], { type: 'image/svg+xml' }),
        `${base}-${safeFileName(level?.name ?? 'plan')}.svg`,
      );
    });
  const dxf = () =>
    task.run('dxf', async () => {
      downloadBlob(
        new Blob([planDxf(project, planLevelId)], { type: 'application/dxf' }),
        `${base}-${safeFileName(level?.name ?? 'plan')}.dxf`,
      );
    });

  const csv = () =>
    downloadBlob(new Blob([bomCsv(project)], { type: 'text/csv' }), `${base}-costs.csv`);

  const snapshot = () =>
    task.run('snapshot', async () => {
      const html = buildSnapshotHtml(project, await fetchViewerBundle());
      downloadBlob(new Blob([html], { type: 'text/html' }), `${base}-snapshot.html`);
      return `${(html.length / 1048576).toFixed(1)} MB`;
    });
  const json = () =>
    downloadBlob(
      new Blob([exportProjectJson(project)], { type: 'application/json' }),
      `${base}.json`,
    );

  const levelOptions = (
    <>
      {levels.map((l) => (
        <option key={l.id} value={l.id}>
          {l.name}
        </option>
      ))}
    </>
  );

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      role="dialog"
      aria-label={t('export.title')}
    >
      <div className="absolute inset-0 bg-slate-900/40" onClick={() => setOpen(false)} />
      <div className="relative flex max-h-full w-full max-w-2xl flex-col rounded-lg bg-white shadow-xl">
        <div className="flex items-center border-b border-slate-200 px-4 py-3">
          <h2 className="flex-1 font-semibold">{t('export.title')}</h2>
          <button
            aria-label={t('drawer.close')}
            className="rounded p-1 hover:bg-slate-100"
            onClick={() => setOpen(false)}
          >
            <X size={16} />
          </button>
        </div>
        <div role="tablist" className="flex flex-wrap gap-1 border-b border-slate-200 px-3 pt-2">
          {TABS.map((id) => (
            <button
              key={id}
              role="tab"
              aria-selected={tab === id}
              onClick={() => setTab(id)}
              className={`rounded-t-md px-3 py-1.5 text-sm ${tab === id ? 'border-b-2 border-sky-600 font-semibold text-sky-700' : 'text-slate-600 hover:bg-slate-50'}`}
            >
              {t(`export.tab.${id}` as 'export.tab.images')}
            </button>
          ))}
        </div>
        <div role="tabpanel" className="min-h-0 flex-1 space-y-3 overflow-auto p-4">
          {tab === 'images' && (
            <>
              <p className="text-xs text-slate-500">{t('export.imagesHelp')}</p>
              <Row label={t('export.resolution')}>
                {([1, 2, 4] as const).map((s) => (
                  <label key={s} className="flex items-center gap-1">
                    <input
                      type="radio"
                      name="imgscale"
                      checked={imgScale === s}
                      onChange={() => setImgScale(s)}
                    />
                    {s}×
                  </label>
                ))}
              </Row>
              <Row label={t('export.format')}>
                <select
                  aria-label={t('export.format')}
                  className={field}
                  value={imgFormat}
                  onChange={(e) => setImgFormat(e.target.value as 'png' | 'jpeg')}
                >
                  <option value="png">PNG</option>
                  <option value="jpeg">JPEG</option>
                </select>
              </Row>
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={transparent && imgFormat === 'png'}
                  disabled={imgFormat !== 'png'}
                  onChange={(e) => setTransparent(e.target.checked)}
                />
                {t('export.transparent')}
              </label>
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={presentation}
                  onChange={(e) => setPresentation(e.target.checked)}
                />
                {t('export.presentation')}
              </label>
              <button className={btn} disabled={!!task.busy} onClick={image}>
                <Download size={14} /> {t('export.downloadImage')}
              </button>
            </>
          )}
          {tab === 'pdf' && (
            <>
              <p className="text-xs text-slate-500">{t('export.pdfHelp')}</p>
              <Row label={t('export.scale')}>
                {([50, 100] as const).map((s) => (
                  <label key={s} className="flex items-center gap-1">
                    <input
                      type="radio"
                      name="pdfscale"
                      checked={pdfScale === s}
                      onChange={() => setPdfScale(s)}
                    />
                    1:{s}
                  </label>
                ))}
              </Row>
              <Row label={t('export.paper')}>
                <select
                  aria-label={t('export.paper')}
                  className={field}
                  value={paper}
                  onChange={(e) => setPaper(e.target.value as Paper)}
                >
                  <option value="auto">{t('export.paperAuto')}</option>
                  <option value="a4">A4</option>
                  <option value="a3">A3</option>
                  <option value="a2">A2</option>
                </select>
              </Row>
              <Row label={t('export.levels')}>
                {levels.map((l) => (
                  <label key={l.id} className="flex items-center gap-1">
                    <input
                      type="checkbox"
                      checked={chosenPdfLevels.includes(l.id)}
                      onChange={(e) =>
                        setPdfLevels(
                          e.target.checked
                            ? [...chosenPdfLevels, l.id]
                            : chosenPdfLevels.filter((x) => x !== l.id),
                        )
                      }
                    />
                    {l.name}
                  </label>
                ))}
              </Row>
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={furniture}
                  onChange={(e) => setFurniture(e.target.checked)}
                />
                {t('export.furniture')}
              </label>
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={cover}
                  onChange={(e) => setCover(e.target.checked)}
                />
                {t('export.cover')}
              </label>
              <button
                className={btn}
                disabled={!!task.busy || !chosenPdfLevels.length}
                onClick={pdf}
              >
                <Download size={14} /> {t('export.downloadPdf')}
              </button>
            </>
          )}
          {tab === 'model' && (
            <>
              <p className="text-xs text-slate-500">{t('export.modelHelp')}</p>
              <Row label={t('export.levelsToExport')}>
                <select
                  aria-label={t('export.levelsToExport')}
                  className={field}
                  value={levelId}
                  onChange={(e) => setLevelId(e.target.value)}
                >
                  <option value="all">{t('export.wholeHome')}</option>
                  {levelOptions}
                </select>
              </Row>
              <div className="flex gap-2">
                <button className={btn} disabled={!!task.busy} onClick={glb}>
                  <Download size={14} /> GLB
                </button>
                <button className={btn} disabled={!!task.busy} onClick={obj}>
                  <Download size={14} /> OBJ + MTL
                </button>
              </div>
            </>
          )}
          {tab === 'plans' && (
            <>
              <p className="text-xs text-slate-500">{t('export.plansHelp')}</p>
              <Row label={t('export.level')}>
                <select
                  aria-label={t('export.level')}
                  className={field}
                  value={planLevelId}
                  onChange={(e) => setPlanLevel(e.target.value)}
                >
                  {levelOptions}
                </select>
              </Row>
              <Row label={t('export.scale')}>
                {([50, 100] as const).map((s) => (
                  <label key={s} className="flex items-center gap-1">
                    <input
                      type="radio"
                      name="svgscale"
                      checked={svgScale === s}
                      onChange={() => setSvgScale(s)}
                    />
                    1:{s}
                  </label>
                ))}
              </Row>
              <div className="flex gap-2">
                <button className={btn} disabled={!!task.busy} onClick={svg}>
                  <Download size={14} /> SVG
                </button>
                <button className={btn} disabled={!!task.busy} onClick={dxf}>
                  <Download size={14} /> DXF
                </button>
              </div>
            </>
          )}
          {tab === 'costs' && <CostsTable currency={bom.currency} />}
          {tab === 'share' && (
            <>
              <p className="text-xs text-slate-500">{t('export.shareHelp')}</p>
              <div className="flex flex-wrap gap-2">
                <button className={btn} disabled={!!task.busy} onClick={snapshot}>
                  <Download size={14} /> {t('export.snapshot')}
                </button>
                <button className={btn} onClick={json}>
                  <Download size={14} /> {t('export.projectJson')}
                </button>
              </div>
            </>
          )}
          {task.busy && (
            <p role="status" className="text-sm text-slate-600">
              {t('export.working')}…
            </p>
          )}
          {task.done && (
            <p role="status" data-testid="export-done" className="text-sm text-emerald-700">
              {t('export.done')} {task.done}
            </p>
          )}
          {task.error && (
            <p role="alert" className="text-sm text-red-600">
              {task.error}
            </p>
          )}
        </div>
        {tab === 'costs' && (
          <div className="flex justify-end border-t border-slate-200 px-4 py-2">
            <button className={btn} onClick={csv}>
              <Download size={14} /> CSV
            </button>
          </div>
        )}
        <p className="border-t border-slate-200 px-4 py-2 text-xs italic text-slate-500">
          {t('export.disclaimer')}
        </p>
      </div>
    </div>
  );
}

/** Editable unit costs with live totals per category and overall. */
function CostsTable({ currency }: { currency: string }) {
  const t = useT();
  const project = useModel((s) => s.project);
  const bom = useMemo(() => priceBom(project), [project]);
  const fmt = useMemo(
    () =>
      new Intl.NumberFormat(undefined, { style: 'currency', currency, maximumFractionDigits: 2 }),
    [currency],
  );
  return (
    <div className="space-y-2">
      <p className="text-xs text-slate-500">{t('export.costsHelp')}</p>
      <Row label={t('export.currency')}>
        <select
          aria-label={t('export.currency')}
          className={field}
          value={currency}
          onChange={(e) => useModel.getState().apply((p) => setCurrency(p, e.target.value))}
        >
          {CURRENCIES.map((c) => (
            <option key={c}>{c}</option>
          ))}
          {!(CURRENCIES as readonly string[]).includes(currency) && <option>{currency}</option>}
        </select>
      </Row>
      <table className="w-full text-sm">
        <thead>
          <tr className="text-left text-xs text-slate-500">
            <th className="py-1 font-medium">{t('export.item')}</th>
            <th className="font-medium">{t('export.qty')}</th>
            <th className="font-medium">{t('export.unitCost')}</th>
            <th className="text-right font-medium">{t('export.lineTotal')}</th>
          </tr>
        </thead>
        <tbody>
          {BOM_CATEGORIES.flatMap((c) => {
            const lines = bom.lines.filter((l) => l.category === c);
            if (!lines.length) return [];
            return [
              <tr key={`h-${c}`}>
                <th
                  colSpan={4}
                  className="pt-3 text-left text-xs uppercase tracking-wide text-slate-500"
                >
                  {t(`export.cat.${c}` as 'export.cat.walls')}
                </th>
              </tr>,
              ...lines.map((l) => (
                <tr key={l.key} data-testid="cost-row">
                  <td className="py-0.5 pr-2">{l.label}</td>
                  <td className="pr-2 whitespace-nowrap">
                    {l.quantity} {l.unit}
                  </td>
                  <td className="pr-2">
                    <input
                      type="number"
                      min={0}
                      step="any"
                      aria-label={`${t('export.unitCost')}: ${l.label}`}
                      className="w-24 rounded border border-slate-300 px-1 py-0.5 text-right"
                      defaultValue={l.unitCost || ''}
                      key={`${l.key}:${l.unitCost}`}
                      onBlur={(e) => {
                        const v = e.target.value === '' ? 0 : Number(e.target.value);
                        if (Number.isFinite(v) && v >= 0 && v !== l.unitCost)
                          useModel.getState().apply((p) => setUnitCost(p, l.key, v));
                      }}
                      onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
                    />
                  </td>
                  <td className="text-right tabular-nums">{fmt.format(l.total)}</td>
                </tr>
              )),
              <tr key={`s-${c}`} className="border-t border-slate-200 text-xs text-slate-600">
                <td colSpan={3} className="py-0.5 text-right">
                  {t('export.subtotal')}
                </td>
                <td className="text-right tabular-nums">{fmt.format(bom.byCategory[c])}</td>
              </tr>,
            ];
          })}
        </tbody>
        <tfoot>
          <tr className="border-t-2 border-slate-300 font-semibold">
            <td colSpan={3} className="py-1 text-right">
              {t('export.total')}
            </td>
            <td data-testid="cost-total" className="text-right tabular-nums">
              {fmt.format(bom.total)}
            </td>
          </tr>
        </tfoot>
      </table>
    </div>
  );
}
