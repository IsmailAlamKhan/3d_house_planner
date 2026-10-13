export type JobKind = 'design' | 'render';

export interface GpuHooks {
  /** Runs before a render job starts (unload the language model so the image model fits in VRAM). */
  beforeRender?: () => Promise<void>;
  /** Runs after a render job (ask ComfyUI to free its memory). */
  afterRender?: () => Promise<void>;
}

interface Entry {
  id: string;
  kind: JobKind;
  start: () => void;
  /** Rejects the caller's promise (used when a waiting job is cancelled). */
  abort: (e: Error) => void;
}

/**
 * The single GPU job queue: AI design jobs (language model) and render jobs (image model) run strictly one at a time,
 * in arrival order, so the two never share a 16 GB card. Switching to a render unloads the language model first and a
 * finished render frees the image model's memory.
 */
export class GpuQueue {
  private waiting: Entry[] = [];
  private current: Entry | null = null;
  private n = 0;

  constructor(private readonly hooks: GpuHooks = {}) {}

  /** Jobs running or waiting. */
  get pending(): number {
    return this.waiting.length + (this.current ? 1 : 0);
  }

  /** What is running now and what is waiting (for the "who is ahead of me" displays). */
  snapshot(): {
    running: { id: string; kind: JobKind } | null;
    waiting: { id: string; kind: JobKind }[];
  } {
    return {
      running: this.current ? { id: this.current.id, kind: this.current.kind } : null,
      waiting: this.waiting.map((e) => ({ id: e.id, kind: e.kind })),
    };
  }

  /** Jobs in front of `id` (0 when it is running or first in line; -1 when it is not in the queue). */
  ahead(id: string): number {
    if (this.current?.id === id) return 0;
    const i = this.waiting.findIndex((e) => e.id === id);
    return i < 0 ? -1 : i + (this.current ? 1 : 0);
  }

  /** Removes a job that has not started yet; returns whether it was still waiting. */
  cancel(id: string): boolean {
    const i = this.waiting.findIndex((e) => e.id === id);
    if (i < 0) return false;
    const [entry] = this.waiting.splice(i, 1);
    entry!.abort(new Error('Cancelled'));
    return true;
  }

  /** Queues `job`; resolves with its result (or rejects with its error) when its turn has come and gone. */
  run<T>(kind: JobKind, job: () => Promise<T>, id = `${kind}-${++this.n}`): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const entry: Entry = {
        id,
        kind,
        start: () => {
          void this.execute(entry, job).then(resolve, reject);
        },
        abort: reject,
      };
      this.waiting.push(entry);
      this.pump();
    });
  }

  private pump(): void {
    if (this.current || !this.waiting.length) return;
    const next = this.waiting.shift()!;
    this.current = next;
    next.start();
  }

  private async execute<T>(entry: Entry, job: () => Promise<T>): Promise<T> {
    try {
      if (entry.kind === 'render') await this.hooks.beforeRender?.().catch(() => undefined);
      return await job();
    } finally {
      if (entry.kind === 'render') await this.hooks.afterRender?.().catch(() => undefined);
      this.current = null;
      this.pump();
    }
  }
}
