// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { GpuQueue } from './gpuQueue';

const gate = () => {
  let open!: () => void;
  const p = new Promise<void>((r) => (open = r));
  return { p, open };
};

describe('GPU job queue', () => {
  it('runs design and render jobs one at a time, in arrival order', async () => {
    const q = new GpuQueue();
    const log: string[] = [];
    const g1 = gate();
    const g2 = gate();
    const a = q.run('design', async () => {
      log.push('a:start');
      await g1.p;
      log.push('a:end');
      return 'a';
    });
    const b = q.run('render', async () => {
      log.push('b:start');
      await g2.p;
      log.push('b:end');
      return 'b';
    });
    const c = q.run('design', async () => {
      log.push('c:start');
      return 'c';
    });
    await Promise.resolve();
    expect(log).toEqual(['a:start']); // nothing else starts while a runs
    g1.open();
    await a;
    await new Promise((r) => setTimeout(r, 0));
    expect(log).toEqual(['a:start', 'a:end', 'b:start']);
    g2.open();
    expect(await Promise.all([b, c])).toEqual(['b', 'c']);
    expect(log).toEqual(['a:start', 'a:end', 'b:start', 'b:end', 'c:start']);
    expect(q.pending).toBe(0);
  });

  it('never overlaps jobs, even when one fails', async () => {
    const q = new GpuQueue();
    let running = 0;
    let maxRunning = 0;
    const job = (fail: boolean) => async () => {
      running++;
      maxRunning = Math.max(maxRunning, running);
      await new Promise((r) => setTimeout(r, 5));
      running--;
      if (fail) throw new Error('boom');
    };
    const results = await Promise.allSettled([
      q.run('design', job(false)),
      q.run('render', job(true)),
      q.run('design', job(false)),
      q.run('render', job(false)),
    ]);
    expect(results.map((r) => r.status)).toEqual([
      'fulfilled',
      'rejected',
      'fulfilled',
      'fulfilled',
    ]);
    expect(maxRunning).toBe(1);
  });

  it('unloads the language model before a render and frees the image model after it', async () => {
    const log: string[] = [];
    const q = new GpuQueue({
      beforeRender: async () => void log.push('unload-llm'),
      afterRender: async () => void log.push('free-comfy'),
    });
    await q.run('design', async () => void log.push('design'));
    await q.run('render', async () => void log.push('render'));
    await q.run('design', async () => void log.push('design2'));
    expect(log).toEqual(['design', 'unload-llm', 'render', 'free-comfy', 'design2']);
  });

  it('a failing hook does not break the queue', async () => {
    const q = new GpuQueue({
      beforeRender: async () => {
        throw new Error('ollama down');
      },
      afterRender: async () => {
        throw new Error('comfy down');
      },
    });
    expect(await q.run('render', async () => 7)).toBe(7);
    expect(await q.run('design', async () => 8)).toBe(8);
  });

  it('reports what is running and how many jobs are ahead, and can cancel a waiting job', async () => {
    const q = new GpuQueue();
    const g = gate();
    const first = q.run('render', () => g.p, 'r1');
    const second = q.run('design', async () => 'd', 'd1');
    const third = q.run('render', async () => 'r', 'r2');
    expect(q.snapshot()).toEqual({
      running: { id: 'r1', kind: 'render' },
      waiting: [
        { id: 'd1', kind: 'design' },
        { id: 'r2', kind: 'render' },
      ],
    });
    expect(q.ahead('r1')).toBe(0);
    expect(q.ahead('d1')).toBe(1);
    expect(q.ahead('r2')).toBe(2);
    expect(q.ahead('nope')).toBe(-1);
    const rejected = expect(second).rejects.toThrow('Cancelled');
    expect(q.cancel('d1')).toBe(true);
    await rejected;
    expect(q.ahead('r2')).toBe(1);
    expect(q.cancel('r1')).toBe(false); // running jobs cannot be removed
    g.open();
    await first;
    expect(await third).toBe('r');
  });
});
