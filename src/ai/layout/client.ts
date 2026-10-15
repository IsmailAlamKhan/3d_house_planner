import { getLanguage } from '../../i18n';
import type { LayoutPlan } from './plan';
import { type SolveInput, solveCandidates } from './solve';
import type { WorkerReply, WorkerRequest } from './layout.worker';

let worker: Worker | null = null;
let counter = 0;

/**
 * The best `count` different layouts for a design. Runs in a Web Worker when the browser has one (the optimiser
 * keeps the page responsive and can be cancelled); in tests and old browsers it runs on the calling thread.
 */
export function solveInWorker(
  input: SolveInput,
  count = 3,
  signal?: AbortSignal,
): Promise<LayoutPlan[]> {
  if (typeof Worker === 'undefined') return Promise.resolve(solveCandidates(input, count));
  return new Promise<LayoutPlan[]>((resolve, reject) => {
    if (signal?.aborted) return reject(new DOMException('Cancelled', 'AbortError'));
    let w: Worker;
    try {
      worker ??= new Worker(new URL('./layout.worker.ts', import.meta.url), { type: 'module' });
      w = worker;
    } catch {
      // A browser that refuses module workers: do the work here.
      return resolve(solveCandidates(input, count));
    }
    const id = ++counter;
    const done = () => {
      w.removeEventListener('message', onMessage);
      w.removeEventListener('error', onError);
      signal?.removeEventListener('abort', onAbort);
    };
    const onMessage = (e: MessageEvent<WorkerReply>) => {
      if (e.data.id !== id) return;
      done();
      if ('error' in e.data) reject(new Error(e.data.error));
      else resolve(e.data.plans);
    };
    const onError = (e: ErrorEvent) => {
      done();
      worker?.terminate();
      worker = null;
      // The worker could not start (blocked, or not built): fall back to the main thread.
      try {
        resolve(solveCandidates(input, count));
      } catch {
        reject(new Error(e.message || 'The layout worker failed.'));
      }
    };
    const onAbort = () => {
      done();
      // The search cannot be interrupted from outside: drop the worker so the next run starts fresh.
      worker?.terminate();
      worker = null;
      reject(new DOMException('Cancelled', 'AbortError'));
    };
    w.addEventListener('message', onMessage);
    w.addEventListener('error', onError);
    signal?.addEventListener('abort', onAbort);
    const request: WorkerRequest = { id, input, count, language: getLanguage() };
    w.postMessage(request);
  });
}
