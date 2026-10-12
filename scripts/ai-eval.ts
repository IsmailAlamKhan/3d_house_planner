/**
 * Runs the sample briefs against the configured local model and reports how often it produced a usable design.
 *
 *   npm run ai:eval                 # uses OLLAMA_URL / OLLAMA_MODEL from .env or the environment
 *   npm run ai:eval -- --limit 5    # only the first 5 briefs
 *
 * "Valid" = the answer passed the DesignIntent schema (after the single repair round); "solver ok" = the layout
 * solver turned it into a design whose rooms are all reachable through doors.
 */
import { writeFileSync } from 'node:fs';
import { produce } from 'immer';
import { loadConfig } from '../server/config';
import { runChecks } from '../src/checks';
import { generateIntent } from '../src/ai/pipeline';
import { type LLMProvider, ProviderError, ProviderUnreachable } from '../src/ai/provider';
import { EVAL_BRIEFS } from '../src/ai/fixtures/briefs';
import { applyPlan } from '../src/ai/layout/apply';
import { solveLayout } from '../src/ai/layout/solve';
import { largestInnerRect } from '../src/ai/layout/rect';
import { createSampleProject } from '../src/model/sample';

const config = loadConfig();
const limit = Number(process.argv[process.argv.indexOf('--limit') + 1]) || EVAL_BRIEFS.length;
let calls = 0;

/** Talks to Ollama directly (the browser goes through /api/ai; here we are already on the server side). */
const provider: LLMProvider = {
  id: 'ollama',
  async generate(req) {
    calls++;
    let res: Response;
    try {
      res = await fetch(`${config.ollamaUrl}/api/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: config.model,
          messages: req.messages,
          stream: false,
          think: false,
          ...(req.schema ? { format: req.schema } : {}),
          options: { temperature: req.temperature ?? 0.2, num_ctx: 8192 },
        }),
        signal: AbortSignal.timeout(180_000),
      });
    } catch (e) {
      throw new ProviderUnreachable(e instanceof Error ? e.message : 'unreachable');
    }
    const json = (await res.json()) as { message?: { content?: string }; error?: string };
    if (json.error) throw new ProviderError(json.error);
    return json.message?.content ?? '';
  },
};

const sample = createSampleProject();
const rect = largestInnerRect(sample.shell.footprint).rect;
const shell = { width: rect.w, depth: rect.h };

console.log(
  `Model ${config.model} at ${config.ollamaUrl} — ${Math.min(limit, EVAL_BRIEFS.length)} briefs\n`,
);
const rows: {
  id: string;
  valid: boolean;
  repaired: boolean;
  solverOk: boolean;
  matches: boolean;
  seconds: number;
  note: string;
}[] = [];

for (const brief of EVAL_BRIEFS.slice(0, limit)) {
  calls = 0;
  const t0 = performance.now();
  let valid = false;
  let solverOk = false;
  let matches = true;
  let note = '';
  try {
    const r = await generateIntent(brief.text, {
      settings: {
        provider: 'ollama',
        model: config.model,
        openaiBaseUrl: '',
        openaiModel: '',
        timeoutSec: 180,
      },
      shell,
      provider,
    });
    valid = r.source === 'ollama' && !r.fellBack;
    if (!valid) note = r.notes[0] ?? 'fell back to the offline generator';
    const bedrooms = r.intent.levels
      .flatMap((l) => l.rooms)
      .filter((x) => x.type === 'bedroom').length;
    if (brief.expect?.bedrooms !== undefined && bedrooms < brief.expect.bedrooms) matches = false;
    if (brief.expect?.levels !== undefined && r.intent.levels.length < brief.expect.levels)
      matches = false;
    if (valid) {
      try {
        const plan = solveLayout({
          intent: r.intent,
          footprint: sample.shell.footprint,
          entrance: sample.shell.entrance,
          plumbing: sample.shell.fixedPlumbingPoints,
          columns: [],
          maxHeight: sample.shell.maxHeight,
        });
        const project = produce(sample, (d) => void applyPlan(d, plan, r.intent.style));
        solverOk =
          !runChecks(project).some((i) => i.rule === 'unreachable') &&
          !plan.warnings.some((w) => /could not be reached/.test(w));
        if (!solverOk) note = 'solver: some rooms unreachable';
      } catch (e) {
        note = `solver threw: ${e instanceof Error ? e.message : String(e)}`;
      }
    }
  } catch (e) {
    note = e instanceof Error ? e.message : String(e);
  }
  const seconds = (performance.now() - t0) / 1000;
  rows.push({ id: brief.id, valid, repaired: calls > 1, solverOk, matches, seconds, note });
  console.log(
    `${valid ? '✓' : '✗'} ${brief.id.padEnd(14)} ${seconds.toFixed(1).padStart(6)} s  repair:${calls > 1 ? 'yes' : 'no '}  solver:${solverOk ? 'ok ' : 'FAIL'}  brief-match:${matches ? 'yes' : 'no'}  ${note}`,
  );
}

const n = rows.length;
const pct = (k: number) => `${((100 * k) / n).toFixed(0)} %`;
const validN = rows.filter((r) => r.valid).length;
const solverN = rows.filter((r) => r.solverOk).length;
const avg = rows.reduce((s, r) => s + r.seconds, 0) / n;
console.log(`\nSchema-valid (after the repair round): ${validN}/${n} = ${pct(validN)}`);
console.log(`Needed the repair round:               ${rows.filter((r) => r.repaired).length}/${n}`);
console.log(`Solver success (all rooms reachable):  ${solverN}/${n} = ${pct(solverN)}`);
console.log(`Followed the brief (bedrooms/levels):  ${rows.filter((r) => r.matches).length}/${n}`);
console.log(`Average time per generation:           ${avg.toFixed(1)} s`);
writeFileSync(
  'ai-eval-results.json',
  JSON.stringify(
    {
      model: config.model,
      at: new Date().toISOString(),
      validRate: validN / n,
      solverRate: solverN / n,
      avgSeconds: avg,
      rows,
    },
    null,
    2,
  ),
);
process.exit(validN / n >= 0.9 ? 0 : 1);
