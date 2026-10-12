import { produce } from 'immer';
import { describe, expect, it } from 'vitest';
import { runChecks } from '../checks';
import { createSampleProject } from '../model/sample';
import { briefProblems } from './briefCheck';
import { applyPlan } from './layout/apply';
import { solveLayout } from './layout/solve';
import { generateIntent } from './pipeline';
import type { LLMProvider, LLMRequest } from './provider';
import { DesignIntentSchema } from './schemas';

const room = (type: string, name: string, targetArea: number) => ({ type, name, targetArea });
const oneLevel = DesignIntentSchema.parse({
  levels: [
    {
      name: 'Ground floor',
      rooms: [
        room('living', 'Living room', 28),
        room('kitchen', 'Kitchen', 13),
        room('dining', 'Dining area', 11),
        room('study', 'Home office', 10),
        room('bathroom', 'Guest bathroom', 5),
      ],
    },
  ],
});
const twoLevels = DesignIntentSchema.parse({
  levels: [
    { name: 'Ground', rooms: [room('living', 'Living', 24), room('kitchen', 'Kitchen', 12)] },
    {
      name: 'Upper',
      rooms: [
        room('bedroom', 'Bedroom 1', 14),
        room('bedroom', 'Bedroom 2', 12),
        room('bedroom', 'Bedroom 3', 11),
      ],
    },
  ],
});

describe('brief check', () => {
  it('a duplex needs two levels and "3 bedroom" needs three bedrooms', () => {
    expect(briefProblems('3 bedroom duplex with home office', oneLevel).join(' ')).toMatch(
      /2 levels/,
    );
    expect(briefProblems('3 bedroom duplex with home office', oneLevel).join(' ')).toMatch(
      /3 bedrooms but the design has only 0/,
    );
    expect(briefProblems('3 bedroom duplex', twoLevels)).toEqual([]);
    expect(briefProblems('a cosy studio', oneLevel)).toEqual([]);
    expect(briefProblems('three bedrooms upstairs', twoLevels)).toEqual([]);
    expect(briefProblems('four bedrooms', twoLevels).join(' ')).toMatch(/4 bedrooms/);
  });

  it('sends the problem back to the model once and uses the corrected answer', async () => {
    const calls: LLMRequest[] = [];
    const replies = [JSON.stringify(oneLevel), JSON.stringify(twoLevels)];
    const provider: LLMProvider = {
      id: 'ollama',
      async generate(req) {
        calls.push(req);
        return replies[calls.length - 1]!;
      },
    };
    const r = await generateIntent('3 bedroom duplex', {
      settings: {
        provider: 'ollama',
        model: 'm',
        openaiBaseUrl: '',
        openaiModel: '',
        timeoutSec: 5,
      },
      shell: { width: 10, depth: 12 },
      provider,
    });
    expect(calls).toHaveLength(2);
    expect(calls[1]!.messages.at(-1)!.content).toMatch(/duplex/);
    expect(r.source).toBe('ollama');
    expect(r.intent.levels).toHaveLength(2);
  });

  it('keeps the first answer when the retry is no better', async () => {
    const provider: LLMProvider = { id: 'ollama', generate: async () => JSON.stringify(oneLevel) };
    const r = await generateIntent('3 bedroom duplex', {
      settings: {
        provider: 'ollama',
        model: 'm',
        openaiBaseUrl: '',
        openaiModel: '',
        timeoutSec: 5,
      },
      shell: { width: 10, depth: 12 },
      provider,
    });
    expect(r.intent.levels).toHaveLength(1);
  });
});

describe('single-level designs', () => {
  it('every room is reachable through doors from the entrance', () => {
    const s = createSampleProject();
    const plan = solveLayout({
      intent: oneLevel,
      footprint: s.shell.footprint,
      entrance: s.shell.entrance,
      plumbing: s.shell.fixedPlumbingPoints,
      columns: s.columns
        .filter((c) => c.levelId === s.levels[0]!.id)
        .map((c) => ({ position: c.position, size: c.size })),
      maxHeight: s.shell.maxHeight,
    });
    expect(plan.warnings.join(' ')).not.toMatch(/could not be reached/);
    const p = produce(s, (d) => void applyPlan(d, plan, oneLevel.style));
    expect(runChecks(p).filter((i) => i.rule === 'unreachable')).toEqual([]);
  });
});
