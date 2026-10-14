import { expect, test } from '@playwright/test';
import { COUNT_DRAWS, goToView, loadVilla, record, villaProject } from './helpers';

// How long the villa takes to become smooth after it is opened with the real asset pack: frames per second in
// one-second buckets, the long (> 100 ms) main-thread tasks and the files fetched. Written to test-results/gpu/loading.json.
const project = villaProject();

test('the villa with the asset pack becomes smooth within 15 seconds of opening', async ({
  page,
}) => {
  const fetched: { t: number; file: string }[] = [];
  const t0 = Date.now();
  page.on('requestfinished', (r) => {
    if (/\/pack\//.test(r.url()))
      fetched.push({
        t: Math.round((Date.now() - t0) / 100) / 10,
        file: r.url().split('/pack/')[1]!,
      });
  });
  await page.addInitScript(COUNT_DRAWS);
  await page.addInitScript(() => {
    const w = window as unknown as { __long: { start: number; ms: number }[] };
    w.__long = [];
    new PerformanceObserver((l) => {
      for (const e of l.getEntries())
        w.__long.push({ start: Math.round(e.startTime), ms: Math.round(e.duration) });
    }).observe({ entryTypes: ['longtask'] });
  });
  await loadVilla(page, project, { quality: 'medium', lighting: { mode: 'dusk', time: 19.4 } });
  const sample = (n: number) =>
    page.evaluate(
      (n) =>
        new Promise<number[]>((resolve) => {
          const out: number[] = [];
          let frames = 0;
          let last = performance.now();
          const tick = () => {
            frames++;
            const now = performance.now();
            if (now - last >= 1000) {
              out.push(Math.round((frames * 1000) / (now - last)));
              frames = 0;
              last = now;
            }
            if (out.length >= n) resolve(out);
            else requestAnimationFrame(tick);
          };
          requestAnimationFrame(tick);
        }),
      n,
    );
  const buckets = await sample(25);
  const views: Record<string, number[]> = {};
  for (const v of ['Front gate', 'Isometric']) {
    await goToView(page, v);
    views[v] = await sample(20);
    console.log(`fps per second after going to ${v}:`, views[v]!.join(' '));
  }
  const long = await page.evaluate(() => (window as unknown as { __long: unknown[] }).__long);
  record('loading', { fpsPerSecond: buckets, afterViewChange: views, longTasks: long, fetched });
  const smoothAt = buckets.findIndex((v, i) => buckets.slice(i, i + 3).every((x) => x >= 30));
  console.log('fps per second after opening:', buckets.join(' '));
  expect(smoothAt).toBeGreaterThanOrEqual(0);
  expect(smoothAt).toBeLessThanOrEqual(15);
});
