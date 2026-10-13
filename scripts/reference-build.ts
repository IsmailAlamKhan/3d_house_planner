/**
 * Builds a project exactly from a reference spec, writes the fidelity report and saves the project.
 *
 *   npm run reference:build -- reference/villa.spec.json                  # saves to the app server (default http://127.0.0.1:8080)
 *   npm run reference:build -- reference/villa.spec.json --out villa.json  # writes the project file instead
 *
 * Options:
 *   --out <file>        write the project JSON to a file (no server needed; import it with Projects → Import)
 *   --server <url>      app server to save to (default $REFERENCE_SERVER or http://127.0.0.1:8080)
 *   --password <text>   the server's APP_PASSWORD (default $APP_PASSWORD)
 *   --id <id>           project id (default: "ref-" + the spec's file name). The same id is replaced on every run.
 *   --fidelity <file>   where to write the report (default: FIDELITY.md next to the spec)
 *   --no-fidelity       skip the report
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { buildProject, describeReport } from '../src/reference/build';
import { fidelityMarkdown } from '../src/reference/fidelity';
import { parseReferenceSpec } from '../src/reference/spec';

const args = process.argv.slice(2);
const flag = (name: string): string | undefined => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : undefined;
};
const has = (name: string) => args.includes(`--${name}`);
const VALUED = new Set(['out', 'server', 'password', 'id', 'fidelity']);
const specPath = args.find(
  (a, i) =>
    !a.startsWith('--') &&
    !(i > 0 && args[i - 1]!.startsWith('--') && VALUED.has(args[i - 1]!.slice(2))),
);

if (!specPath) {
  console.error(
    'Usage: npm run reference:build -- <spec.json> [--out file] [--server url] [--id id]',
  );
  process.exit(2);
}

const file = resolve(specPath);
const raw = JSON.parse(readFileSync(file, 'utf8')) as unknown;
const spec = parseReferenceSpec(raw);
const id =
  flag('id') ??
  `ref-${basename(file)
    .replace(/\.spec\.json$|\.json$/, '')
    .replace(/[^\w-]+/g, '-')}`.slice(0, 64);
const result = buildProject(raw, { id });

console.log(describeReport(result.report));
for (const d of result.report.designs) for (const w of d.warnings) console.log(`  [${d.id}] ${w}`);

if (!has('no-fidelity')) {
  const out = flag('fidelity') ?? join(dirname(file), 'FIDELITY.md');
  writeFileSync(out, fidelityMarkdown(spec, result), 'utf8');
  console.log(`Fidelity report: ${out}`);
}

const outFile = flag('out');
if (outFile) {
  writeFileSync(outFile, JSON.stringify(result.project), 'utf8');
  console.log(`Project written to ${outFile}`);
  process.exit(0);
}

const server = (flag('server') ?? process.env.REFERENCE_SERVER ?? 'http://127.0.0.1:8080').replace(
  /\/+$/,
  '',
);
const password = flag('password') ?? process.env.APP_PASSWORD;
const headers: Record<string, string> = {};
try {
  if (password) {
    const r = await fetch(`${server}/api/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ password }).toString(),
      redirect: 'manual',
    });
    const cookie = r.headers.get('set-cookie')?.split(';')[0];
    if (!cookie) throw new Error('The password was not accepted.');
    headers.Cookie = cookie;
  }
  const post = () =>
    fetch(`${server}/api/projects`, {
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify(result.project),
    });
  let r = await post();
  if (r.status === 409) {
    // The same project from an earlier run: replace it (the build is the source of truth).
    const d = await fetch(`${server}/api/projects/${id}`, { method: 'DELETE', headers });
    if (!d.ok) throw new Error(`Could not replace the earlier project (${d.status}).`);
    r = await post();
  }
  if (r.status === 401)
    throw new Error('The server needs a password: set APP_PASSWORD or use --password.');
  if (!r.ok) throw new Error(`The server refused the project (${r.status}): ${await r.text()}`);
  console.log(`Saved "${result.project.name}" (id ${id}) to ${server}. Open it from Projects.`);
} catch (e) {
  console.error(`Could not save to ${server}: ${(e as Error).message}`);
  console.error('Tip: add --out villa.json to write a file you can import instead.');
  process.exit(1);
}
