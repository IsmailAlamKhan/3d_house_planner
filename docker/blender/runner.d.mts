export interface RunnerHealth {
  ready: boolean;
  version?: string;
  device?: string;
  problem?: string;
}
export interface RunnerJob {
  id: string;
  status: 'running' | 'done' | 'error' | 'cancelled';
  progress: { sample: number; total: number; etaSeconds: number | null } | null;
  error?: string;
  result?: Record<string, unknown>;
}
export interface Runner {
  check(force?: boolean): Promise<RunnerHealth>;
  start(id: string, quality: string): { job: RunnerJob; done: Promise<RunnerJob> };
  cancel(id: string): boolean;
  info(id: string): RunnerJob | null;
}
export function createRunner(opts: {
  blender: string;
  script?: string;
  jobsDir: string;
  assetsDir?: string;
  spawnFn?: unknown;
}): Runner;
