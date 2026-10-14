/**
 * `npm run ai:eval:vision` — how well does the picture-reading pipeline read a plan?
 *
 * It runs the real pipeline (`src/ai/vision/extract.ts`, the same code the app runs) on
 *   1. `reference/villa-reference.png`, straightened with the underlay corners of `reference/villa.spec.json` and
 *      judged against the hand-traced Option B of that spec (names, printed sizes, boxes);
 *   2. four plans this script draws itself (SVG rendered by Chromium), each with known answers.
 * and reports label recall, printed-size accuracy and room position error in feet, before any manual correction.
 *
 *   npm run ai:eval:vision                       # asks the vision model through Ollama ($OLLAMA_URL, $OLLAMA_VISION_MODEL)
 *   npm run ai:eval:vision -- --server http://127.0.0.1:8080   # through the app's /api/vision instead (the GPU queue)
 *   npm run ai:eval:vision -- --oracle           # a pretend model that answers from the truth: checks the harness (100 %)
 *   npm run ai:eval:vision -- --only villa|s1|s2|s3|s4  --json out.json  --out reference/EVAL_VISION.md
 *
 * Targets on the reference villa (before manual correction): ≥ 90 % of labels read correctly, room centres within 3 ft.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { chromium } from '@playwright/test';
import {
  applyHomography,
  invertMatrix3,
  multiplyMatrix3,
  rectifyFromCorners,
  rectifyRaster,
} from '../src/geometry/homography';
import { type Candidate } from '../src/ai/vision/assemble';
import { type VisionClient, type VisionRequest } from '../src/ai/vision/client';
import { type Extraction, extract } from '../src/ai/vision/extract';
import { nameSimilarity } from '../src/ai/vision/labels';
import { type PictureSource } from '../src/ai/vision/source';
import { type Raster, cropScaled, decodePng, encodePng } from './lib/png';

const args = process.argv.slice(2);
const flag = (n: string) => {
  const i = args.indexOf(`--${n}`);
  return i >= 0 ? args[i + 1] : undefined;
};
const has = (n: string) => args.includes(`--${n}`);
const OLLAMA = (process.env.OLLAMA_URL ?? 'http://127.0.0.1:11434').replace(/\/+$/, '');
const MODEL = process.env.OLLAMA_VISION_MODEL ?? 'qwen3-vl:8b-instruct';
const FT = 0.3048;

// ───────────────────────────── a model to ask ─────────────────────────────

function ollamaClient(): VisionClient {
  const server = flag('server');
  return {
    async ask(req: VisionRequest) {
      if (server) {
        const r = await fetch(`${server.replace(/\/+$/, '')}/api/vision`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            prompt: req.prompt,
            system: req.system,
            images: req.images,
            schema: req.schema,
            temperature: 0,
          }),
          signal: AbortSignal.timeout(300_000),
        });
        const j = (await r.json()) as { content?: string; error?: string };
        if (!r.ok) throw new Error(j.error ?? `vision ${r.status}`);
        return j.content ?? '';
      }
      const r = await fetch(`${OLLAMA}/api/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: MODEL,
          stream: false,
          think: false,
          messages: [
            ...(req.system ? [{ role: 'system', content: req.system }] : []),
            { role: 'user', content: req.prompt, images: req.images },
          ],
          ...(req.schema ? { format: req.schema } : {}),
          options: { temperature: 0, num_ctx: 8192 },
        }),
        signal: AbortSignal.timeout(300_000),
      });
      const j = (await r.json()) as { message?: { content?: string }; error?: string };
      if (!r.ok || j.error) throw new Error(j.error ?? `ollama ${r.status}`);
      return j.message?.content ?? '';
    },
  };
}

// ───────────────────────────── ground truth ─────────────────────────────

interface TruthItem {
  name: string;
  /** Printed size in feet, if the picture prints one. */
  label?: [number, number];
  /** [x, y, w, d] in feet, in the picture's own feet (origin at the picture's top-left). */
  rect: [number, number, number, number];
}
interface Dataset {
  id: string;
  title: string;
  raster: Raster;
  ftPerPx: number;
  truth: TruthItem[];
}

/** The reference villa: the picture straightened exactly as the app's reference picture is, truth = Option B of the spec. */
function villa(): Dataset {
  const spec = JSON.parse(readFileSync('reference/villa.spec.json', 'utf8')) as {
    underlay: {
      corners: [number, number][];
      size: [number, number];
      origin: [number, number];
      imageSize: [number, number];
    };
    designs: { id: string; rooms: Row[]; zones: Row[] }[];
  };
  type Row = {
    name: string;
    rect?: [number, number, number, number];
    pic?: [number, number, number, number];
    labelSize?: [number, number];
  };
  const u = spec.underlay;
  const src = decodePng(readFileSync('reference/villa-reference.png'));
  const W = u.size[0] * FT;
  const D = u.size[1] * FT;
  const h = rectifyFromCorners(
    u.corners.map(([x, y]) => ({ x, y })),
    W,
    D,
    { x: 0, y: 0 },
  )!;
  const inv = invertMatrix3(h)!;
  const ppm = 1800 / Math.max(W, D);
  const out = rectifyRaster(
    { data: src.data, width: src.width, height: src.height },
    multiplyMatrix3([1, 0, 0, 0, 1, 0, 0, 0, 1], inv),
    { x0: 0, y0: 0, x1: W, y1: D },
    ppm,
  );
  // truth: Option B rooms and areas that have a picture box, moved so the picture's top-left corner is (0, 0)
  const B = spec.designs[spec.designs.length - 1]!;
  const truth: TruthItem[] = [...B.rooms, ...B.zones]
    .filter(
      (r) => r.pic && r.rect && r.labelSize, // only what the picture prints a label (and size) for
    )
    .map((r) => ({
      // the picture prints "Bath" where the spec says "Guest Bath"
      name: r.name === 'Guest Bath' ? 'Bath' : r.name,
      ...(r.labelSize ? { label: r.labelSize } : {}),
      rect: [r.rect![0] - u.origin[0], r.rect![1] - u.origin[1], r.rect![2], r.rect![3]] as [
        number,
        number,
        number,
        number,
      ],
    }));
  void applyHomography;
  return {
    id: 'villa',
    title: 'Reference villa (hand-traced)',
    raster: { data: out.data, width: out.width, height: out.height },
    ftPerPx: 1 / ppm / FT,
    truth,
  };
}

// Four plans drawn here, with known answers. 1 px = 1/PX ft.
const PX = 24;
interface SynthRoom {
  name: string;
  /** What is printed under the name: "14' x 12'", "4.2 × 3.6 m" or nothing. */
  print?: string;
  label?: [number, number];
  zone?: boolean;
  rect: [number, number, number, number]; // feet
  fill?: string;
}
const synth: Record<
  string,
  { title: string; w: number; h: number; font: number; rooms: SynthRoom[] }
> = {
  s1: {
    title: 'S1 — three rooms, feet',
    w: 40,
    h: 24,
    font: 15,
    rooms: [
      { name: 'Living Room', print: "20' x 14'", label: [20, 14], rect: [2, 2, 20, 14] },
      { name: 'Kitchen', print: "12' x 10'", label: [12, 10], rect: [22, 2, 12, 10] },
      { name: 'Bedroom 1', print: "12' x 12'", label: [12, 12], rect: [22, 12, 12, 12] },
    ],
  },
  s2: {
    title: 'S2 — metric apartment',
    w: 38,
    h: 28,
    font: 15,
    rooms: [
      {
        name: 'Living',
        print: '5.5 × 4.0 m',
        label: [5.5 / FT, 4.0 / FT],
        rect: [2, 2, 5.5 / FT, 4.0 / FT],
      },
      {
        name: 'Kitchen',
        print: '3.0 × 4.0 m',
        label: [3.0 / FT, 4.0 / FT],
        rect: [2 + 5.5 / FT, 2, 3.0 / FT, 4.0 / FT],
      },
      {
        name: 'Bedroom',
        print: '4.0 × 3.5 m',
        label: [4.0 / FT, 3.5 / FT],
        rect: [2, 2 + 4.0 / FT, 4.0 / FT, 3.5 / FT],
      },
      {
        name: 'Bath',
        print: '2.0 × 3.5 m',
        label: [2.0 / FT, 3.5 / FT],
        rect: [2 + 4.0 / FT, 2 + 4.0 / FT, 2.0 / FT, 3.5 / FT],
      },
      {
        name: 'Study',
        print: '2.5 × 3.5 m',
        label: [2.5 / FT, 3.5 / FT],
        rect: [2 + 6.0 / FT, 2 + 4.0 / FT, 2.5 / FT, 3.5 / FT],
      },
    ],
  },
  s3: {
    title: 'S3 — villa with pool and garden',
    w: 56,
    h: 40,
    font: 14,
    rooms: [
      { name: 'Foyer', print: "10' x 8'", label: [10, 8], rect: [22, 18, 10, 8] },
      { name: 'Living & Dining Area', print: "22' x 16'", label: [22, 16], rect: [20, 2, 22, 16] },
      { name: 'Bedroom 2', print: "14' x 12'", label: [14, 12], rect: [6, 2, 14, 12] },
      { name: 'Bath 2', print: "8' x 6'", label: [8, 6], rect: [6, 14, 8, 6] },
      { name: 'Kitchen', print: "14' x 10'", label: [14, 10], rect: [42, 2, 14, 10] },
      { name: 'Gym', print: "14' x 12'", label: [14, 12], rect: [42, 12, 14, 12] },
      {
        name: 'Infinity Pool',
        print: "20' x 12'",
        label: [20, 12],
        zone: true,
        rect: [6, 26, 20, 12],
        fill: '#bfe7f5',
      },
      {
        name: 'Garden Lounge',
        print: "16' x 10'",
        label: [16, 10],
        zone: true,
        rect: [30, 28, 16, 10],
        fill: '#cfe8c4',
      },
    ],
  },
  s4: {
    title: 'S4 — small type, some labels without sizes',
    w: 60,
    h: 36,
    font: 11,
    rooms: [
      { name: 'Master Bedroom', print: "16' x 14'", label: [16, 14], rect: [2, 2, 16, 14] },
      { name: 'Walk-in Closet', print: "8' x 6'", label: [8, 6], rect: [18, 2, 8, 6] },
      { name: 'Ensuite', rect: [18, 8, 8, 8] },
      { name: 'Study', print: "12' x 10'", label: [12, 10], rect: [26, 2, 12, 10] },
      { name: 'Garage', print: "20' x 18'", label: [20, 18], rect: [38, 2, 20, 18] },
      { name: 'Utility', print: "6' x 8'", label: [6, 8], rect: [26, 12, 6, 8] },
      { name: 'Hall', rect: [2, 16, 30, 4] },
      { name: 'Guest Room', print: "14' x 12'", label: [14, 12], rect: [2, 20, 14, 12] },
      { name: 'Dining', print: "14' x 12'", label: [14, 12], rect: [16, 20, 14, 12] },
    ],
  },
};

async function render(id: string): Promise<Dataset> {
  const p = synth[id]!;
  const W = p.w * PX;
  const H = p.h * PX;
  const rects = p.rooms
    .map((r) => {
      const [x, y, w, d] = r.rect.map((v) => v * PX) as [number, number, number, number];
      const cx = x + w / 2;
      const cy = y + d / 2;
      return `<rect x="${x}" y="${y}" width="${w}" height="${d}" fill="${r.fill ?? '#f3ede2'}" stroke="${r.zone ? '#5a7d4a' : '#1f2937'}" stroke-width="${r.zone ? 3 : 7}" ${r.zone ? 'stroke-dasharray="10 6"' : ''}/>
<text x="${cx}" y="${cy - (r.print ? 3 : -p.font / 3)}" font-size="${p.font}" font-family="Arial, sans-serif" font-weight="bold" text-anchor="middle" fill="#111">${r.name.replace(/&/g, '&amp;')}</text>
${r.print ? `<text x="${cx}" y="${cy + p.font + 1}" font-size="${p.font}" font-family="Arial, sans-serif" text-anchor="middle" fill="#111">${r.print}</text>` : ''}`;
    })
    .join('\n');
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}"><rect width="100%" height="100%" fill="#ffffff"/>${rects}</svg>`;
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage({ viewport: { width: W, height: H } });
    await page.setContent(`<html><body style="margin:0">${svg}</body></html>`);
    const png = await page.screenshot({ type: 'png', clip: { x: 0, y: 0, width: W, height: H } });
    return {
      id,
      title: p.title,
      raster: decodePng(Buffer.from(png)),
      ftPerPx: 1 / PX,
      truth: p.rooms.map((r) => ({
        name: r.name,
        ...(r.label ? { label: r.label } : {}),
        rect: r.rect,
      })),
    };
  } finally {
    await browser.close();
  }
}

// ───────────────────────────── the oracle (a pretend model that knows the truth) ─────────────────────────────

function oracle(
  ds: Dataset,
  crops: Map<string, { x: number; y: number; w: number; h: number }>,
): VisionClient {
  const printOf = (t: TruthItem) =>
    t.label
      ? `${Math.round(t.label[0] * 10) / 10}' x ${Math.round(t.label[1] * 10) / 10}'`
      : undefined;
  return {
    async ask(req) {
      const c = crops.get(req.images[0]!)!;
      const nx = (px: number) => Math.round(((px - c.x) / c.w) * 1000);
      const ny = (py: number) => Math.round(((py - c.y) / c.h) * 1000);
      const boxPx = (t: TruthItem) =>
        [
          t.rect[0] / ds.ftPerPx,
          t.rect[1] / ds.ftPerPx,
          (t.rect[0] + t.rect[2]) / ds.ftPerPx,
          (t.rect[1] + t.rect[3]) / ds.ftPerPx,
        ] as const;
      if (/text label/.test(req.prompt))
        return JSON.stringify({
          labels: ds.truth
            .filter((t) => {
              const b = boxPx(t);
              const cx = (b[0] + b[2]) / 2;
              const cy = (b[1] + b[3]) / 2;
              return cx >= c.x && cx <= c.x + c.w && cy >= c.y && cy <= c.y + c.h;
            })
            .map((t) => {
              const b = boxPx(t);
              return {
                name: t.name,
                ...(printOf(t) ? { size: printOf(t) } : {}),
                x: nx((b[0] + b[2]) / 2),
                y: ny((b[1] + b[3]) / 2),
              };
            }),
        });
      return JSON.stringify({
        regions: ds.truth
          .map((t) => {
            const b = boxPx(t);
            const x0 = Math.max(b[0], c.x);
            const y0 = Math.max(b[1], c.y);
            const x1 = Math.min(b[2], c.x + c.w);
            const y1 = Math.min(b[3], c.y + c.h);
            return x1 - x0 > 8 && y1 - y0 > 8
              ? { label: t.name, kind: 'room', x0: nx(x0), y0: ny(y0), x1: nx(x1), y1: ny(y1) }
              : null;
          })
          .filter(Boolean),
      });
    },
  };
}

// ───────────────────────────── metrics ─────────────────────────────

interface Result {
  id: string;
  title: string;
  truth: number;
  labelled: number;
  /** Share of the truth's names that were read (similar name among the labels or rooms found). */
  labelRecall: number;
  /** Share of truth items with a printed size whose size was read within 0.6 ft (either orientation). */
  sizeRead: number;
  matched: number;
  /** Mean |width error| and |depth error| of the boxes, feet. */
  boxError: number;
  centreMean: number;
  centreMedian: number;
  within3ft: number;
  seconds: number;
  notes: string[];
  missed: string[];
}

const near = (a: [number, number], b: [number, number], tol: number) =>
  (Math.abs(a[0] - b[0]) <= tol && Math.abs(a[1] - b[1]) <= tol) ||
  (Math.abs(a[0] - b[1]) <= tol && Math.abs(a[1] - b[0]) <= tol);

function score(ds: Dataset, x: Extraction, seconds: number): Result {
  const f = ds.ftPerPx;
  const foundNames = [...x.labels.map((l) => l.name), ...x.candidates.map((c) => c.name)];
  const read = ds.truth.filter((t) => foundNames.some((n) => nameSimilarity(n, t.name) >= 0.8));
  const withSize = ds.truth.filter((t) => t.label);
  const sizeOk = withSize.filter((t) =>
    x.labels.some(
      (l) => nameSimilarity(l.name, t.name) >= 0.8 && l.size && near(l.size, t.label!, 0.6),
    ),
  );
  const used = new Set<Candidate>();
  const errors: number[] = [];
  const boxErr: number[] = [];
  for (const t of ds.truth) {
    const tc: [number, number] = [t.rect[0] + t.rect[2] / 2, t.rect[1] + t.rect[3] / 2];
    const cands = x.candidates
      .filter((c) => !used.has(c) && nameSimilarity(c.name, t.name) >= 0.8)
      .map((c) => {
        const cc: [number, number] = [
          ((c.box[0] + c.box[2]) / 2) * f,
          ((c.box[1] + c.box[3]) / 2) * f,
        ];
        return { c, cc, d: Math.hypot(cc[0] - tc[0], cc[1] - tc[1]) };
      })
      .sort((a, b) => a.d - b.d);
    const best = cands[0];
    if (!best) continue;
    used.add(best.c);
    errors.push(best.d);
    boxErr.push(
      (Math.abs((best.c.box[2] - best.c.box[0]) * f - t.rect[2]) +
        Math.abs((best.c.box[3] - best.c.box[1]) * f - t.rect[3])) /
        2,
    );
  }
  errors.sort((a, b) => a - b);
  const mean = (v: number[]) => (v.length ? v.reduce((s, q) => s + q, 0) / v.length : NaN);
  return {
    id: ds.id,
    title: ds.title,
    truth: ds.truth.length,
    labelled: withSize.length,
    labelRecall: read.length / ds.truth.length,
    sizeRead: withSize.length ? sizeOk.length / withSize.length : 1,
    matched: errors.length,
    boxError: mean(boxErr),
    centreMean: mean(errors),
    centreMedian: errors.length ? errors[Math.floor(errors.length / 2)]! : NaN,
    within3ft: ds.truth.length ? errors.filter((e) => e <= 3).length / ds.truth.length : 0,
    seconds,
    notes: x.notes,
    missed: ds.truth.filter((t) => !read.includes(t)).map((t) => t.name),
  };
}

// ───────────────────────────── main ─────────────────────────────

async function run(ds: Dataset): Promise<Result> {
  const crops = new Map<string, { x: number; y: number; w: number; h: number }>();
  const source: PictureSource = {
    width: ds.raster.width,
    height: ds.raster.height,
    async crop(box, maxSide) {
      const png = encodePng(cropScaled(ds.raster, box, maxSide)).toString('base64');
      crops.set(png, box);
      return png;
    },
  };
  const client = has('oracle') ? oracle(ds, crops) : ollamaClient();
  const t0 = Date.now();
  const x = await extract({
    client,
    source,
    ftPerPx: ds.ftPerPx,
    onProgress: (p) => process.stdout.write(`\r  ${ds.id}: ${p.phase} ${p.done}/${p.total}   `),
  });
  process.stdout.write('\r' + ' '.repeat(60) + '\r');
  return score(ds, x, (Date.now() - t0) / 1000);
}

const pct = (v: number) => (Number.isFinite(v) ? `${(v * 100).toFixed(0)} %` : '—');
const ft = (v: number) => (Number.isFinite(v) ? `${v.toFixed(1)} ft` : '—');

const only = flag('only');
const ids = ['villa', 's1', 's2', 's3', 's4'].filter((i) => !only || only.split(',').includes(i));
const results: Result[] = [];
for (const id of ids) {
  const ds = id === 'villa' ? villa() : await render(id);
  console.log(
    `${ds.title}: ${ds.raster.width} × ${ds.raster.height} px, ${ds.truth.length} truth items`,
  );
  try {
    results.push(await run(ds));
  } catch (e) {
    console.error(`  failed: ${(e as Error).message}`);
  }
}

const header = `| Plan | Labels read | Printed sizes read | Rooms matched | Box size error | Centre error (mean / median) | Centres within 3 ft | Time |\n| --- | --- | --- | --- | --- | --- | --- | --- |`;
const rows = results.map(
  (r) =>
    `| ${r.title} | ${pct(r.labelRecall)} (${Math.round(r.labelRecall * r.truth)}/${r.truth}) | ${pct(r.sizeRead)} | ${r.matched}/${r.truth} | ${ft(r.boxError)} | ${ft(r.centreMean)} / ${ft(r.centreMedian)} | ${pct(r.within3ft)} | ${r.seconds.toFixed(0)} s |`,
);
const table = [header, ...rows].join('\n');
console.log(`\n${table}\n`);
const v = results.find((r) => r.id === 'villa');
if (v) {
  const ok = v.labelRecall >= 0.9 && v.within3ft >= 0.9;
  console.log(
    `Reference villa target (≥ 90 % of labels read, centres within 3 ft before correction): labels ${pct(v.labelRecall)}, centres within 3 ft ${pct(v.within3ft)} → ${ok ? 'MET' : 'NOT MET'}`,
  );
}
for (const r of results)
  if (r.missed.length) console.log(`  [${r.id}] not read: ${r.missed.join('; ')}`);
for (const r of results) for (const n of r.notes.slice(0, 5)) console.log(`  [${r.id}] ${n}`);
const md = flag('out');
if (md)
  writeFileSync(
    md,
    `# Vision evaluation\n\nModel: \`${has('oracle') ? 'oracle (harness check)' : flag('server') ? `app server (${flag('server')})` : MODEL}\`. Generated by \`npm run ai:eval:vision\`.\n\n${table}\n`,
    'utf8',
  );
const json = flag('json');
if (json) writeFileSync(json, JSON.stringify(results, null, 1), 'utf8');
process.exit(0);
