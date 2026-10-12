import { type Part, disposeParts } from './generators/common';

interface Entry {
  deps: unknown[];
  parts: Part[];
}

const sameDeps = (a: unknown[], b: unknown[]): boolean =>
  a.length === b.length && a.every((v, i) => Object.is(v, b[i]));

/**
 * Memoizes generator output per entity. An entry is rebuilt only when its dependency list changes
 * (compared by identity — the immer-based store keeps untouched entities referentially equal).
 * Call `begin()` before a build pass and `sweep()` after it: entries not requested during the pass
 * are removed, and every replaced or removed geometry is disposed.
 */
export class PartCache {
  private entries = new Map<string, Entry>();
  private touched = new Set<string>();
  /** Number of generator invocations since creation (used by tests / perf checks). */
  builds = 0;

  begin(): void {
    this.touched.clear();
  }

  get(key: string, deps: unknown[], build: () => Part[]): Part[] {
    this.touched.add(key);
    const hit = this.entries.get(key);
    if (hit && sameDeps(hit.deps, deps)) return hit.parts;
    if (hit) disposeParts(hit.parts);
    this.builds++;
    const parts = build();
    this.entries.set(key, { deps, parts });
    return parts;
  }

  sweep(): void {
    for (const [key, e] of this.entries) {
      if (!this.touched.has(key)) {
        disposeParts(e.parts);
        this.entries.delete(key);
      }
    }
  }

  dispose(): void {
    for (const e of this.entries.values()) disposeParts(e.parts);
    this.entries.clear();
  }

  get size(): number {
    return this.entries.size;
  }
}
