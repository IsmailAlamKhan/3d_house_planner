/**
 * Judges the layout engines on 30 briefs (duplexes, apartment shells with columns, villas on plots) and compares the
 * new optimiser ("v2") with the original treemap solver on the same briefs.
 *
 *   npm run eval:layout                 # both engines, writes reports/layout-eval.png and reports/layout-eval.json
 *   npm run eval:layout -- --limit 6    # the first 6 briefs only
 *
 * Every candidate is judged by `planMetrics` (src/ai/layout/metrics.ts), which looks only at the finished plan.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import sharp from 'sharp';
import { LAYOUT_BRIEFS, type LayoutBrief, solveInputFor } from '../src/ai/fixtures/layoutBriefs';
import { offlineIntent } from '../src/ai/offline';
import { type PlanMetrics, planMetrics } from '../src/ai/layout/metrics';
import type { LayoutPlan } from '../src/ai/layout/plan';
import { solveCandidates, solveLayout } from '../src/ai/layout/solve';

const limit = Number(process.argv[process.argv.indexOf('--limit') + 1]) || LAYOUT_BRIEFS.length;
const CANDIDATES = 3;

type Engine = 'treemap' | 'v2';
interface Row {
  brief: string;
  engine: Engine;
  seconds: number;
  plans: LayoutPlan[];
  metrics: PlanMetrics[];
}

function run(b: LayoutBrief, engine: Engine): Row {
  const base = solveInputFor(b);
  const villa = !!b.plot;
  const intents = [0, 1, 2].map((i) => ({
    ...offlineIntent(b.text, i, { villa }).intent,
    furnish: true,
  }));
  const t0 = performance.now();
  const plans =
    engine === 'v2'
      ? solveCandidates({ intent: intents[0]!, ...base, engine }, CANDIDATES)
      : intents.map((intent, i) => solveLayout({ intent, ...base, engine, seed: i + 1 }));
  const seconds = (performance.now() - t0) / 1000;
  const metrics = plans.map((p, i) =>
    planMetrics(p, engine === 'v2' ? intents[0]! : intents[i]!, {
      plot: base.plot,
      columns: base.columns,
    }),
  );
  return { brief: b.id, engine, seconds, plans, metrics };
}

const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);

const briefs = LAYOUT_BRIEFS.slice(0, limit);
const rows: Row[] = [];
for (const b of briefs) {
  for (const engine of ['treemap', 'v2'] as Engine[]) {
    const r = run(b, engine);
    rows.push(r);
    const ms = r.metrics;
    const why = ms
      .flatMap((m) => m.violations)
      .slice(0, 2)
      .join('; ');
    console.log(
      `${b.id.padEnd(16)} ${engine.padEnd(8)} ${r.seconds.toFixed(2).padStart(6)} s  hard ${ms.filter((m) => m.hardOk).length}/${ms.length}  ` +
        `quality ${mean(ms.map((m) => m.quality)).toFixed(1)}  adj ${mean(ms.map((m) => m.adjacency)).toFixed(2)}  ` +
        `day ${mean(ms.map((m) => m.daylight)).toFixed(2)}  corr ${mean(ms.map((m) => m.corridorRatio)).toFixed(3)}` +
        (why ? `  x ${why}` : ''),
    );
  }
}

const summary = Object.fromEntries(
  (['treemap', 'v2'] as Engine[]).map((engine) => {
    const rs = rows.filter((r) => r.engine === engine);
    const ms = rs.flatMap((r) => r.metrics);
    return [
      engine,
      {
        hardPassRate: ms.filter((m) => m.hardOk).length / ms.length,
        quality: mean(ms.map((m) => m.quality)),
        adjacency: mean(ms.map((m) => m.adjacency)),
        daylight: mean(ms.map((m) => m.daylight)),
        corridorRatio: mean(ms.map((m) => m.corridorRatio)),
        thinRooms: mean(ms.map((m) => m.thin)),
        ensuiteBeside: mean(ms.map((m) => m.ensuiteBeside)),
        stacked: mean(ms.map((m) => m.stacked)),
        privacy: mean(ms.map((m) => m.privacy)),
        wallLines: mean(ms.map((m) => m.wallLines)),
        walkways: mean(ms.map((m) => m.walkways)),
        secondsPerBrief: mean(rs.map((r) => r.seconds)),
      },
    ];
  }),
);
console.table(summary);

// ── Contact sheet: for every brief the first candidate of each engine (ground level, and the upper level if any) ──
const COLORS: Record<string, string> = {
  living: '#f3d9a4',
  dining: '#f0c987',
  kitchen: '#f4b6a0',
  bedroom: '#a8c8f0',
  bathroom: '#9fe0d8',
  corridor: '#e5e7eb',
  stair: '#d1d5db',
  foyer: '#e8dcc8',
  study: '#c9b8ec',
  garage: '#c7cbd1',
  outdoor: '#bfe3b0',
};
function planSvg(plan: LayoutPlan, level: number, x0: number, y0: number, size: number): string {
  const s = plan.shell;
  const k = Math.min(size / s.w, size / s.h);
  const parts: string[] = [
    `<rect x="${x0}" y="${y0}" width="${s.w * k}" height="${s.h * k}" fill="#fff" stroke="#111" stroke-width="2"/>`,
  ];
  for (const r of plan.rooms.filter((r) => r.level === level && !r.void)) {
    parts.push(
      `<rect x="${x0 + (r.rect.x - s.x) * k}" y="${y0 + (r.rect.y - s.y) * k}" width="${r.rect.w * k}" height="${r.rect.h * k}" fill="${COLORS[r.type] ?? '#f1f5f9'}" stroke="#334155" stroke-width="1"/>`,
    );
  }
  for (const o of plan.openings.filter((o) => o.level === level)) {
    parts.push(
      `<circle cx="${x0 + (o.at.x - s.x) * k}" cy="${y0 + (o.at.y - s.y) * k}" r="${o.kind === 'window' ? 2.2 : 2.6}" fill="${o.kind === 'window' ? '#2563eb' : '#dc2626'}"/>`,
    );
  }
  return parts.join('');
}
const CELL = 150;
const cols = 3;
const W = cols * (CELL * 4 + 30) + 20;
const rowsN = Math.ceil(briefs.length / cols);
const H = rowsN * (CELL + 46) + 20;
const svg: string[] = [
  `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" font-family="monospace" font-size="11"><rect width="100%" height="100%" fill="#0f172a"/>`,
];
briefs.forEach((b, i) => {
  const cx = 10 + (i % cols) * (CELL * 4 + 30);
  const cy = 10 + Math.floor(i / cols) * (CELL + 46);
  svg.push(`<text x="${cx}" y="${cy + 12}" fill="#e2e8f0">${b.id}</text>`);
  (['treemap', 'v2'] as Engine[]).forEach((engine, ei) => {
    const row = rows.find((r) => r.brief === b.id && r.engine === engine)!;
    const plan = row.plans[0]!;
    const m = row.metrics[0]!;
    const levels = plan.levelNames.length;
    for (let li = 0; li < Math.min(2, levels); li++)
      svg.push(planSvg(plan, li, cx + (ei * 2 + li) * (CELL + 8), cy + 22, CELL));
    svg.push(
      `<text x="${cx + ei * 2 * (CELL + 8)}" y="${cy + CELL + 36}" fill="${m.hardOk ? '#86efac' : '#fca5a5'}">${engine} q${m.quality.toFixed(0)} adj${m.adjacency.toFixed(2)} day${m.daylight.toFixed(2)} c${m.corridorRatio.toFixed(2)}</text>`,
    );
  });
});
svg.push('</svg>');
mkdirSync('reports', { recursive: true });
await sharp(Buffer.from(svg.join('')))
  .png()
  .toFile('reports/layout-eval.png');
writeFileSync(
  'reports/layout-eval.json',
  JSON.stringify(
    {
      summary,
      rows: rows.map((r) => ({
        brief: r.brief,
        engine: r.engine,
        seconds: r.seconds,
        metrics: r.metrics,
      })),
    },
    null,
    1,
  ),
);
console.log('wrote reports/layout-eval.png and reports/layout-eval.json');
