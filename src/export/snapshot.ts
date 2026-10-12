import type { Project } from '../model/types';

export interface ViewerBundle {
  js: string;
  css: string;
}

/** Loads the pre-built viewer (script + styles) that ships next to the app. */
export async function fetchViewerBundle(
  base = import.meta.env.BASE_URL ?? '/',
): Promise<ViewerBundle> {
  const get = async (name: string) => {
    const res = await fetch(`${base}viewer/${name}`);
    if (!res.ok)
      throw new Error(`The viewer file ${name} is missing (run "npm run build:viewer").`);
    return res.text();
  };
  const [js, css] = await Promise.all([get('viewer.js'), get('viewer.css')]);
  return { js, css };
}

const escapeHtml = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** JSON that is safe inside a <script type="application/json"> element (no "</script", no "<!--"). */
export const safeJson = (value: unknown): string =>
  JSON.stringify(value)
    .replace(/</g, '\\u003c')
    .replace(new RegExp('\\u2028', 'g'), '\\u2028')
    .replace(new RegExp('\\u2029', 'g'), '\\u2029');

/**
 * A single self-contained .html file: the minimal viewer, its styles and the project JSON. It needs no network and
 * no server — open it from disk in any modern browser.
 */
export function buildSnapshotHtml(
  project: Project,
  bundle: ViewerBundle,
  exportedAt = new Date().toISOString().slice(0, 10),
): string {
  // A literal "</script" inside the inlined bundle would end the element early.
  const js = bundle.js.replace(/<\/script/gi, '<\\/script');
  const css = bundle.css.replace(/<\/style/gi, '<\\/style');
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(project.name)} — Duplex Designer snapshot</title>
<style>html,body,#viewer-root{height:100%;margin:0}body{font-family:system-ui,sans-serif}</style>
<style>${css}</style>
</head>
<body>
<div id="viewer-root">Loading…</div>
<noscript>This snapshot needs JavaScript.</noscript>
<script id="project-data" type="application/json" data-meta="${escapeHtml(JSON.stringify({ exportedAt }))}">${safeJson(project)}</script>
<script>${js}</script>
</body>
</html>
`;
}
