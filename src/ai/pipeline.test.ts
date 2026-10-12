import { afterEach, describe, expect, it, vi } from 'vitest';
import { createSampleProject } from '../model/sample';
import { NO_SELECTION } from '../model/store';
import { extractJson, generateIntent, interpretEdit, validate, AiOutputError } from './pipeline';
import {
  callProxy,
  createOllamaProvider,
  ProviderError,
  ProviderUnreachable,
  testConnection,
  type AiSettings,
  type LLMProvider,
  type LLMRequest,
} from './provider';
import { DesignIntentSchema } from './schemas';
import { offlineEdit } from './offlineEdit';

const settings: AiSettings = {
  provider: 'ollama',
  model: 'qwen3:14b',
  openaiBaseUrl: 'http://127.0.0.1:1234/v1',
  openaiModel: '',
  timeoutSec: 30,
};
const shell = { width: 10, depth: 12 };
const goodIntent = {
  levels: [
    {
      name: 'Ground',
      rooms: [
        { type: 'living', name: 'Living', targetArea: 24 },
        { type: 'kitchen', name: 'Kitchen', targetArea: 12 },
      ],
    },
    { name: 'Upper', rooms: [{ type: 'bedroom', name: 'Bedroom', targetArea: 15 }] },
  ],
};

function fake(replies: (string | Error)[]): { provider: LLMProvider; calls: LLMRequest[] } {
  const calls: LLMRequest[] = [];
  let i = 0;
  return {
    calls,
    provider: {
      id: 'ollama',
      async generate(req) {
        calls.push(req);
        const r = replies[Math.min(i++, replies.length - 1)]!;
        if (r instanceof Error) throw r;
        return r;
      },
    },
  };
}

afterEach(() => vi.unstubAllGlobals());

describe('JSON extraction & validation', () => {
  it('strips code fences, think blocks and chatter', () => {
    expect(extractJson('```json\n{"a":1}\n```')).toEqual({ a: 1 });
    expect(extractJson('<think>hmm {x}</think>{"a":2}')).toEqual({ a: 2 });
    expect(extractJson('Sure! Here you go: {"a":3} Hope that helps.')).toEqual({ a: 3 });
    expect(() => extractJson('no json here')).toThrow();
  });
  it('reports readable validation errors', () => {
    const r = validate(
      DesignIntentSchema,
      JSON.stringify({
        levels: [{ name: 'x', rooms: [{ type: 'ballroom', name: 'B', targetArea: 5 }] }],
      }),
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.join(' ')).toMatch(/levels\.0\.rooms\.0\.type/);
    expect(validate(DesignIntentSchema, 'garbage').ok).toBe(false);
  });
});

describe('generateIntent', () => {
  it('uses the model answer when it is valid (with the schema sent for constrained decoding)', async () => {
    const f = fake([JSON.stringify(goodIntent)]);
    const r = await generateIntent('2 bed duplex', { settings, shell, provider: f.provider });
    expect(r.source).toBe('ollama');
    expect(r.intent.levels).toHaveLength(2);
    expect(f.calls).toHaveLength(1);
    expect(f.calls[0]!.schema).toBeDefined();
    expect(f.calls[0]!.messages[0]!.content).toMatch(/10\.0 m × 12\.0 m/);
    expect(f.calls[0]!.messages[1]!.content).toMatch(/2 bed duplex/);
  });

  it('accepts fenced output', async () => {
    const f = fake(['```json\n' + JSON.stringify(goodIntent) + '\n```']);
    expect((await generateIntent('x', { settings, shell, provider: f.provider })).source).toBe(
      'ollama',
    );
  });

  it('sends validation errors back once (repair round-trip) and then accepts the fixed answer', async () => {
    const bad = JSON.stringify({
      levels: [{ name: 'G', rooms: [{ type: 'ballroom', name: 'B', targetArea: 5 }] }],
    });
    const f = fake([bad, JSON.stringify(goodIntent)]);
    const r = await generateIntent('x', { settings, shell, provider: f.provider });
    expect(r.source).toBe('ollama');
    expect(f.calls).toHaveLength(2);
    const repairMsgs = f.calls[1]!.messages;
    expect(repairMsgs.at(-2)!.role).toBe('assistant');
    expect(repairMsgs.at(-1)!.content).toMatch(/not valid/);
    expect(repairMsgs.at(-1)!.content).toMatch(/levels\.0\.rooms\.0\.type/);
  });

  it('falls back to the offline generator after a failed repair — never returning unvalidated output', async () => {
    const f = fake(['{"levels": []}', 'still wrong']);
    const r = await generateIntent('2 bedroom duplex', { settings, shell, provider: f.provider });
    expect(f.calls).toHaveLength(2);
    expect(r.source).toBe('offline');
    expect(r.fellBack).toBe('invalid');
    expect(DesignIntentSchema.safeParse(r.intent).success).toBe(true);
    expect(r.notes.join(' ')).toMatch(/offline generator/);
  });

  it('falls back with a clear message when the model is unreachable', async () => {
    const f = fake([new ProviderUnreachable('connect ECONNREFUSED')]);
    const r = await generateIntent('2 bedroom duplex with open kitchen', {
      settings,
      shell,
      provider: f.provider,
    });
    expect(r.source).toBe('offline');
    expect(r.fellBack).toBe('unreachable');
    expect(r.notes[0]).toMatch(/not reachable/);
    expect(r.intent.levels).toHaveLength(2);
  });

  it('a missing model (provider error) also falls back, showing the hint', async () => {
    const f = fake([new ProviderError('The model "x" is not installed. Run: ollama pull x')]);
    const r = await generateIntent('studio', { settings, shell, provider: f.provider });
    expect(r.source).toBe('offline');
    expect(r.notes[0]).toMatch(/ollama pull/);
  });

  it('offline provider setting never calls the network', async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
    const r = await generateIntent('2 bedroom duplex', {
      settings: { ...settings, provider: 'offline' },
      shell,
    });
    expect(r.source).toBe('offline');
    expect(r.fellBack).toBeUndefined();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('cancelling aborts instead of falling back', async () => {
    const ctl = new AbortController();
    const provider: LLMProvider = {
      id: 'ollama',
      generate: (req) =>
        new Promise((_, reject) => {
          req.signal?.addEventListener('abort', () =>
            reject(new DOMException('aborted', 'AbortError')),
          );
          setTimeout(() => ctl.abort(), 5);
        }),
    };
    await expect(
      generateIntent('x', { settings, shell, provider, signal: ctl.signal }),
    ).rejects.toThrow();
  });
});

describe('interpretEdit', () => {
  const project = createSampleProject();
  const base = { settings, project, selection: NO_SELECTION, activeLevelId: project.levels[0]!.id };

  it('parses valid operations from the model and sends a compact summary, not the project JSON', async () => {
    const f = fake([
      JSON.stringify({
        summary: 'Wider kitchen',
        operations: [{ op: 'resizeRoom', room: 'Kitchen & dining', dimension: 'width', delta: 1 }],
      }),
    ]);
    const r = await interpretEdit('make the kitchen 1 meter wider', {
      ...base,
      provider: f.provider,
    });
    expect(r.source).toBe('ollama');
    expect(r.operations[0]).toMatchObject({ op: 'resizeRoom', delta: 1 });
    const prompt = f.calls[0]!.messages.map((m) => m.content).join('\n');
    expect(prompt).toMatch(/Kitchen & dining \(kitchen\)/);
    expect(prompt).toMatch(/make the kitchen 1 meter wider/);
    expect(prompt.length).toBeLessThan(6000);
    expect(prompt).not.toMatch(/"polygon"/);
  });

  it('repairs once, then falls back to the rule reader for common commands, else explains', async () => {
    const f = fake(['{"operations":[{"op":"explode"}]}', 'nope']);
    const r = await interpretEdit('make the kitchen 1 m wider', { ...base, provider: f.provider });
    expect(f.calls).toHaveLength(2);
    expect(r.source).toBe('offline');
    expect(r.operations[0]).toMatchObject({
      op: 'resizeRoom',
      room: 'Kitchen & dining',
      dimension: 'width',
      delta: 1,
    });
    const down = fake([new ProviderUnreachable('down')]);
    await expect(
      interpretEdit('please make it more magical', { ...base, provider: down.provider }),
    ).rejects.toBeInstanceOf(AiOutputError);
    await expect(
      interpretEdit('please make it more magical', { ...base, provider: down.provider }),
    ).rejects.toThrow(/Start Ollama/);
  });
});

describe('offline edit reader', () => {
  const p = createSampleProject();
  it.each([
    [
      'make the kitchen 1 meter wider',
      { op: 'resizeRoom', room: 'Kitchen & dining', dimension: 'width', delta: 1 },
    ],
    [
      'make the living room 50 cm narrower',
      { op: 'resizeRoom', room: 'Living room', dimension: 'width', delta: -0.5 },
    ],
    [
      'widen the living room by 2m',
      { op: 'resizeRoom', room: 'Living room', dimension: 'width', delta: 2 },
    ],
    [
      'make the study 1 m deeper',
      { op: 'resizeRoom', room: 'Study', dimension: 'depth', delta: 1 },
    ],
    ['rename the study to library', { op: 'renameRoom', room: 'Study', name: 'Library' }],
    [
      'change the floor in the living room to oak',
      { op: 'changeMaterial', target: 'floor', room: 'Living room', material: 'oak' },
    ],
    [
      'paint the living room walls sage green',
      { op: 'changeMaterial', target: 'walls', room: 'Living room', material: 'sage green' },
    ],
    ['paint all walls white', { op: 'changeMaterial', target: 'walls', material: 'white' }],
    ['add a plant to the study', { op: 'addItem', catalogId: 'plant', room: 'Study', count: 1 }],
    ['put 2 chairs in the study', { op: 'addItem', catalogId: 'chair', room: 'Study', count: 2 }],
    [
      'remove the sofa from the living room',
      { op: 'removeItem', catalogId: 'sofa', room: 'Living room' },
    ],
    [
      'add a window to the north wall of the study',
      { op: 'addOpening', kind: 'window', room: 'Study', side: 'north' },
    ],
    ['make the stairs L-shaped', { op: 'changeStairType', type: 'L' }],
    ['change the stair to spiral', { op: 'changeStairType', type: 'spiral' }],
  ])('%s', (cmd, expected) => {
    expect(offlineEdit(cmd, p)?.[0]).toMatchObject(expected);
  });
  it('returns null for what it does not understand', () => {
    expect(offlineEdit('make it pop', p)).toBeNull();
    expect(offlineEdit('make the ballroom wider by 1 m', p)).toBeNull();
  });
});

describe('proxy client', () => {
  const stub = (status: number, body: unknown) =>
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response(typeof body === 'string' ? body : JSON.stringify(body), { status }),
      ),
    );

  it('sends the Ollama envelope: model, messages, format schema, temperature 0.2, num_ctx 8192, think off, no streaming', async () => {
    const fetchMock = vi.fn(
      async () =>
        new Response(JSON.stringify({ message: { content: '{"ok":1}' } }), { status: 200 }),
    );
    vi.stubGlobal('fetch', fetchMock);
    const out = await createOllamaProvider(settings).generate({
      messages: [{ role: 'user', content: 'hi' }],
      schema: { type: 'object' },
    });
    expect(out).toBe('{"ok":1}');
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('/api/ai');
    const env = JSON.parse(init.body as string);
    expect(env).toMatchObject({ target: 'ollama', path: '/api/chat' });
    expect(env.body).toMatchObject({
      model: 'qwen3:14b',
      stream: false,
      think: false,
      format: { type: 'object' },
      options: { temperature: 0.2, num_ctx: 8192 },
    });
  });

  it('maps failures: network/502/HTML → unreachable; missing model → helpful error', async () => {
    stub(502, { error: 'down', code: 'unreachable' });
    await expect(callProxy({ target: 'ollama', path: '/api/chat' })).rejects.toBeInstanceOf(
      ProviderUnreachable,
    );
    stub(404, '<html>not found</html>');
    await expect(callProxy({ target: 'ollama', path: '/api/chat' })).rejects.toBeInstanceOf(
      ProviderUnreachable,
    );
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => Promise.reject(new TypeError('Failed to fetch'))),
    );
    await expect(callProxy({ target: 'ollama', path: '/api/chat' })).rejects.toBeInstanceOf(
      ProviderUnreachable,
    );
    stub(200, { error: 'model "qwen3:14b" not found, try pulling it first' });
    await expect(createOllamaProvider(settings).generate({ messages: [] })).rejects.toThrow(
      /ollama pull qwen3:14b/,
    );
  });

  it('test connection lists installed models and flags a missing one', async () => {
    stub(200, { models: [{ name: 'qwen3:14b' }, { name: 'gemma3:12b' }] });
    expect(await testConnection(settings)).toEqual({
      ok: true,
      models: ['qwen3:14b', 'gemma3:12b'],
      message: 'ok',
    });
    expect((await testConnection({ ...settings, model: 'llama9' })).message).toBe('missing:llama9');
    stub(502, { error: 'x' });
    expect((await testConnection(settings)).ok).toBe(false);
    stub(200, { data: [{ id: 'local-model' }] });
    expect((await testConnection({ ...settings, provider: 'openai' })).models).toEqual([
      'local-model',
    ]);
    expect((await testConnection({ ...settings, provider: 'offline' })).message).toBe('offline');
  });
});
