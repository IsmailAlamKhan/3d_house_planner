import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createSampleProject } from '../model/sample';
import { ProjectSchema } from '../model/schemas';
import { undo, useModel } from '../model/store';
import { useAi } from './aiStore';
import { useAiSettings } from './provider';

const ollamaReply = (content: string) =>
  new Response(JSON.stringify({ message: { content } }), { status: 200 });
const goodIntent = {
  title: 'Test home',
  levels: [
    {
      name: 'Ground',
      rooms: [
        {
          type: 'living',
          name: 'Living',
          targetArea: 26,
          adjacency: [{ room: 'Kitchen', connection: 'open' }],
        },
        { type: 'kitchen', name: 'Kitchen', targetArea: 12 },
        { type: 'bathroom', name: 'WC', targetArea: 4 },
      ],
    },
    {
      name: 'Upper',
      rooms: [
        { type: 'bedroom', name: 'Bedroom', targetArea: 16 },
        { type: 'bathroom', name: 'Bath', targetArea: 6 },
      ],
    },
  ],
};

const reset = () => {
  useAi.setState({
    mode: 'generate',
    input: '2 bedroom duplex',
    furnish: true,
    busy: false,
    startedAt: null,
    done: null,
    error: null,
    candidates: [],
    preview: null,
    controller: null,
  });
  useAiSettings.getState().set({ provider: 'ollama', model: 'qwen3:14b' });
  useModel.getState().loadProject(createSampleProject());
};

beforeEach(reset);
afterEach(() => vi.unstubAllGlobals());

describe('AI store — generate', () => {
  it('with the model running: result comes from Ollama and applies as one undo step', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ollamaReply(JSON.stringify(goodIntent))),
    );
    await useAi.getState().generate(1);
    const c = useAi.getState().candidates;
    expect(c).toHaveLength(1);
    expect(c[0]!.source).toBe('ollama');
    expect(c[0]!.plan.rooms.some((r) => r.name === 'Living')).toBe(true);
    const before = useModel.getState().project;
    useAi.getState().applyCandidate(c[0]!.id);
    const after = useModel.getState().project;
    expect(ProjectSchema.safeParse(after).success).toBe(true);
    expect(after.rooms.some((r) => r.name === 'Living')).toBe(true);
    expect(useAi.getState().candidates).toHaveLength(0);
    undo();
    expect(JSON.stringify(useModel.getState().project.rooms)).toBe(JSON.stringify(before.rooms));
  });

  it('with Ollama stopped: falls back to the offline generator with a clear message', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response(
            JSON.stringify({ error: 'Could not reach the language model.', code: 'unreachable' }),
            { status: 502 },
          ),
      ),
    );
    useAi.getState().setInput('2 bedroom duplex with open kitchen');
    await useAi.getState().generate(1);
    const [c] = useAi.getState().candidates;
    expect(c!.source).toBe('offline');
    expect(c!.fellBack).toBe('unreachable');
    expect(c!.notes[0]).toMatch(/not reachable/);
    expect(useAi.getState().error).toBeNull();
    useAi.getState().applyCandidate(c!.id);
    const p = useModel.getState().project;
    expect(p.levels).toHaveLength(2);
    expect(p.stairs).toHaveLength(1);
    expect(p.openings.some((o) => o.kind === 'door')).toBe(true);
    expect(p.openings.some((o) => o.kind === 'window')).toBe(true);
  });

  it('invalid model output (twice) never reaches the project: the offline generator answers instead', async () => {
    const fetchMock = vi.fn(async () => ollamaReply('{"levels": "nonsense"}'));
    vi.stubGlobal('fetch', fetchMock);
    const before = JSON.stringify(useModel.getState().project);
    await useAi.getState().generate(1);
    expect(fetchMock).toHaveBeenCalledTimes(2); // original + one repair round
    expect(useAi.getState().candidates[0]!.source).toBe('offline');
    expect(useAi.getState().candidates[0]!.fellBack).toBe('invalid');
    expect(JSON.stringify(useModel.getState().project)).toBe(before); // nothing applied yet
  });

  it('"Generate 3 variations" returns three options and stops asking a dead model after the first failure', async () => {
    const fetchMock = vi.fn(async () => new Response('{"error":"x"}', { status: 502 }));
    vi.stubGlobal('fetch', fetchMock);
    await useAi.getState().generate(3);
    const c = useAi.getState().candidates;
    expect(c).toHaveLength(3);
    expect(new Set(c.map((x) => JSON.stringify(x.intent))).size).toBe(3);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('offline-only setting never touches the network and labels results as offline', async () => {
    useAiSettings.getState().set({ provider: 'offline' });
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    await useAi.getState().generate(1);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(useAi.getState().candidates[0]!.fellBack).toBeUndefined();
    expect(useAi.getState().candidates[0]!.source).toBe('offline');
  });

  it('cancel aborts a running generation without leaving a half result', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(
        (_url: string, init: RequestInit) =>
          new Promise<Response>((_, reject) =>
            init.signal!.addEventListener('abort', () =>
              reject(new DOMException('aborted', 'AbortError')),
            ),
          ),
      ),
    );
    const run = useAi.getState().generate(1);
    await Promise.resolve();
    expect(useAi.getState().busy).toBe(true);
    useAi.getState().cancel();
    await run;
    expect(useAi.getState().busy).toBe(false);
    expect(useAi.getState().candidates).toHaveLength(0);
    expect(useAi.getState().error).toBeNull();
  });
});

describe('AI store — edit', () => {
  beforeEach(() => useAi.setState({ mode: 'edit' }));

  it('previews the change, then applies it as ONE undo step', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        ollamaReply(
          JSON.stringify({
            summary: 'Wider living room',
            operations: [
              { op: 'resizeRoom', room: 'Living room', dimension: 'width', delta: 1 },
              { op: 'changeMaterial', target: 'floor', room: 'Study', material: 'marble' },
            ],
          }),
        ),
      ),
    );
    useAi.getState().setInput('make the living room a meter wider and the study floor marble');
    await useAi.getState().runEdit();
    const pv = useAi.getState().preview!;
    expect(pv.source).toBe('ollama');
    expect(pv.error).toBeUndefined();
    expect(pv.changes).toContain('Living room 42.0 m² → 49.0 m²');
    const before = JSON.stringify(useModel.getState().project.rooms);
    useAi.getState().applyEdit();
    expect(JSON.stringify(useModel.getState().project.rooms)).not.toBe(before);
    expect(useAi.getState().done).toMatch(/undo/i);
    undo();
    expect(JSON.stringify(useModel.getState().project.rooms)).toBe(before);
  });

  it('an impossible command shows why, changes nothing, and cannot be applied', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        ollamaReply(
          JSON.stringify({
            operations: [{ op: 'moveWall', room: 'Living room', side: 'north', distance: 2 }],
          }),
        ),
      ),
    );
    useAi.getState().setInput('push the north wall out');
    await useAi.getState().runEdit();
    const pv = useAi.getState().preview!;
    expect(pv.error).toMatch(/outer wall/);
    const before = JSON.stringify(useModel.getState().project);
    useAi.getState().applyEdit();
    expect(JSON.stringify(useModel.getState().project)).toBe(before);
    expect(useModel.temporal.getState().pastStates).toHaveLength(0);
  });

  it('with the model stopped, common commands still work through the built-in reader; others explain', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('{}', { status: 502 })),
    );
    useAi.getState().setInput('make the living room 1 meter wider');
    await useAi.getState().runEdit();
    expect(useAi.getState().preview!.source).toBe('offline');
    expect(useAi.getState().preview!.notes[0]).toMatch(/not reachable/);
    expect(useAi.getState().preview!.changes.length).toBeGreaterThan(0);
    useAi.getState().discardEdit();
    useAi.getState().setInput('make it feel more spacious somehow');
    await useAi.getState().runEdit();
    expect(useAi.getState().error).toMatch(/Start Ollama/);
    expect(useAi.getState().preview).toBeNull();
  });
});
