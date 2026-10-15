/**
 * Judges the Design Copilot on 40 scenarios: 15 text briefs (vague and Bengali ones included), 5 interview transcripts,
 * 5 sketches, 5 "like this, but…" requests and 10 refinement commands.
 *
 *   npm run eval:copilot                 # the offline (keyword) path: no model needed, deterministic
 *   npm run eval:copilot -- --model      # with the local language model (OLLAMA_URL / OLLAMA_MODEL from .env)
 *   npm run eval:copilot -- --limit 8    # the first 8 scenarios
 *
 * Per scenario: brief adherence (requested rooms present, sizes within tolerance, features present, checked by
 * code), check failures left after the self-fix loop, user turns needed, and time. Writes reports/copilot-eval-offline.json (or -model.json).
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { loadConfig } from '../server/config';
import { type LLMProvider, ProviderError, ProviderUnreachable } from '../src/ai/provider';
import { runScenario } from '../src/copilot/evalRun';
import { SCENARIOS } from '../src/copilot/scenarios';

const args = process.argv.slice(2);
const limit = Number(args[args.indexOf('--limit') + 1]) || SCENARIOS.length;
const only = args.includes('--only') ? args[args.indexOf('--only') + 1]!.split(',') : null;
const useModel = args.includes('--model');
const config = loadConfig();

/** Talks to Ollama directly (the browser goes through /api/ai; here we are on the server side). */
const ollama: LLMProvider = {
  id: 'ollama',
  async generate(req) {
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

const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);
const scenarios = (only ? SCENARIOS.filter((s) => only.includes(s.id)) : SCENARIOS).slice(0, limit);
console.log(
  `${useModel ? `Model ${config.model} at ${config.ollamaUrl}` : 'Offline keyword path'} — ${scenarios.length} scenarios\n`,
);
const results = [];
for (const sc of scenarios) {
  const r = await runScenario(sc, { provider: useModel ? ollama : null });
  results.push(r);
  console.log(
    `${r.id.padEnd(14)} ${r.kind.padEnd(9)} ${(r.ms / 1000).toFixed(1).padStart(5)} s  adherence ${(r.adherence * 100).toFixed(0).padStart(3)}%  hard ${r.hardFailures}  turns ${r.turns}` +
      (r.failures.length ? `  ✗ ${r.failures.slice(0, 3).join('; ')}` : '') +
      (r.issues.length ? `  ⚠ ${r.issues.join(' | ')}` : ''),
  );
}
const byKind = Object.fromEntries(
  ['text', 'interview', 'sketch', 'like', 'refine'].map((k) => {
    const rs = results.filter((r) => r.kind === k);
    return [
      k,
      {
        scenarios: rs.length,
        adherence: mean(rs.map((r) => r.adherence)),
        hardFailures: rs.reduce((s, r) => s + r.hardFailures, 0),
        turns: mean(rs.map((r) => r.turns)),
        seconds: mean(rs.map((r) => r.ms / 1000)),
      },
    ];
  }),
);
const summary = {
  mode: useModel ? `model ${config.model}` : 'offline',
  scenarios: results.length,
  adherence: mean(results.map((r) => r.adherence)),
  expectation: mean(results.map((r) => r.expectation)),
  briefChecks: mean(results.map((r) => r.brief)),
  scenariosAbove90: results.filter((r) => r.adherence >= 0.9).length,
  hardFailures: results.reduce((s, r) => s + r.hardFailures, 0),
  turns: mean(results.map((r) => r.turns)),
  secondsPerScenario: mean(results.map((r) => r.ms / 1000)),
  slowestSeconds: Math.max(...results.map((r) => r.ms / 1000)),
};
console.table(byKind);
console.table(summary);
mkdirSync('reports', { recursive: true });
writeFileSync(
  useModel ? 'reports/copilot-eval-model.json' : 'reports/copilot-eval-offline.json',
  JSON.stringify({ summary, byKind, results }, null, 1),
);
console.log(
  'wrote',
  useModel ? 'reports/copilot-eval-model.json' : 'reports/copilot-eval-offline.json',
);
