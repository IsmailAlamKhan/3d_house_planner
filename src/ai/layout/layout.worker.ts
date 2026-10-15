/// <reference lib="webworker" />
import { setLanguage } from '../../i18n';
import type { LayoutPlan } from './plan';
import { type SolveInput, solveCandidates } from './solve';

/**
 * Runs the layout optimiser off the main thread (a 25-room villa takes about a second of search): the page keeps
 * responding and the user can cancel. One request at a time; the reply carries the same id.
 */
export interface WorkerRequest {
  id: number;
  input: SolveInput;
  count: number;
  language: string;
}
export type WorkerReply =
  { id: number; plans: LayoutPlan[]; ms: number } | { id: number; error: string };

self.onmessage = (e: MessageEvent<WorkerRequest>) => {
  const { id, input, count, language } = e.data;
  try {
    setLanguage(language);
    const t0 = performance.now();
    const plans = solveCandidates(input, count);
    const reply: WorkerReply = { id, plans, ms: performance.now() - t0 };
    (self as unknown as Worker).postMessage(reply);
  } catch (err) {
    const reply: WorkerReply = { id, error: err instanceof Error ? err.message : String(err) };
    (self as unknown as Worker).postMessage(reply);
  }
};
