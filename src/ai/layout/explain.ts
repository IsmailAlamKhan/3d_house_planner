import { fmtNum, tf } from '../../i18n';
import type { LevelResult, RoomSpec } from './levelLayout';
import { CORRIDOR_TARGET } from './weights';

/** One line of a plan's score breakdown, in plain language ("Kitchen and dining are connected ✓"). */
export interface ScoreItem {
  /** Stable id of the check (used by the tests and to group the list). */
  id: string;
  ok: boolean;
  text: string;
  /** Name of the level it is about (omitted for whole-building checks). */
  level?: string;
}

/**
 * Turns what the optimiser measured for each level into sentences. Failures come first; the good news is
 * summarised so a person can see at a glance what works and what to ask for next.
 */
export function explain(
  results: LevelResult[],
  specs: RoomSpec[][],
  levelNames: string[],
): ScoreItem[] {
  const bad: ScoreItem[] = [];
  const good: ScoreItem[] = [];
  const push = (item: ScoreItem) => (item.ok ? good : bad).push(item);
  let litRooms = 0;
  let habitable = 0;
  let thinCount = 0;
  let allRooms = 0;
  results.forEach((res, li) => {
    const f = res.facts;
    if (!f) return;
    const level = levelNames[li];
    const typeOf = new Map(specs[li]!.map((s) => [s.name, s.type]));
    for (const a of f.adjacency) {
      const types = [typeOf.get(a.a), typeOf.get(a.b)];
      const ensuite = types.includes('bedroom') && types.includes('bathroom');
      push({
        id: ensuite ? 'ensuite' : 'adjacency',
        ok: a.ok,
        level,
        text: tf(
          ensuite
            ? a.ok
              ? 'layout.ensuiteOk'
              : 'layout.ensuiteNo'
            : a.ok
              ? 'layout.adjOk'
              : 'layout.adjNo',
          ensuite
            ? {
                bed: types[0] === 'bedroom' ? a.a : a.b,
                bath: types[0] === 'bedroom' ? a.b : a.a,
              }
            : { a: a.a, b: a.b },
        ),
      });
    }
    for (const d of f.daylight) {
      if (d.type === 'bathroom' || d.type === 'utility') continue;
      habitable++;
      if (d.outside >= 1.3) litRooms++;
      else
        push({
          id: 'daylight',
          ok: false,
          level,
          text: tf('layout.noOutside', { room: d.room }),
        });
    }
    allRooms += specs[li]!.length;
    for (const th of f.thin) {
      thinCount++;
      push({
        id: 'thin',
        ok: false,
        level,
        text: tf('layout.thin', { room: th.room, ratio: fmtNum(th.ratio, 1) }),
      });
    }
    for (const r of f.throughBedroom)
      push({ id: 'privacy', ok: false, level, text: tf('layout.throughBed', { room: r }) });
    for (const r of res.unreachable)
      push({ id: 'reach', ok: false, level, text: tf('layout.unreach', { room: r }) });
    for (const n of res.narrow)
      push({
        id: 'narrow',
        ok: false,
        level,
        text: tf('layout.narrow', {
          room: n.name,
          w: fmtNum(n.width, 1),
          want: fmtNum(n.wanted, 1),
        }),
      });
    if (f.circulation > 0) {
      const pct = Math.round(f.circulation * 100);
      push({
        id: 'corridor',
        ok: f.circulation <= CORRIDOR_TARGET + 0.005,
        level,
        text: tf(
          f.circulation <= CORRIDOR_TARGET + 0.005 ? 'layout.corridorOk' : 'layout.corridorHigh',
          {
            pct,
          },
        ),
      });
    }
    if (f.stacked.length) {
      const ok = f.stacked.every((s) => s.ok);
      push({ id: 'stacking', ok, level, text: tf(ok ? 'layout.stackOk' : 'layout.stackNo', {}) });
    }
    if (f.wetGrouped !== null)
      push({
        id: 'wet',
        ok: f.wetGrouped,
        level,
        text: tf(f.wetGrouped ? 'layout.wetOk' : 'layout.wetNo', {}),
      });
    for (const v of f.views)
      push({
        id: 'view',
        ok: v.ok,
        level,
        text: tf(v.ok ? 'layout.viewOk' : 'layout.viewNo', { room: v.room }),
      });
  });
  if (habitable && litRooms === habitable)
    good.push({ id: 'daylight', ok: true, text: tf('layout.allOutside', { n: habitable }) });
  if (allRooms && thinCount === 0)
    good.push({ id: 'thin', ok: true, text: tf('layout.noThin', {}) });
  return [...bad, ...good];
}
