import { produce } from 'immer';
import { describe, expect, it } from 'vitest';
import { createSampleProject } from '../model/sample';
import { computeEdges } from './edges';
import { NEGATIVE_PROMPT, STYLE_PRESETS, buildPrompt } from './promptBuilder';
import { CREATIVITY_RANGE, EnhanceParamsSchema, EnhanceRequestSchema } from './protocol';

describe('prompt builder', () => {
  const project = createSampleProject();

  it('describes the view, the light, the rooms and the materials of the design', () => {
    const { prompt, negative } = buildPrompt({
      project,
      preset: 'cutaway-top',
      look: 'dusk',
      style: 'modern-luxury',
    });
    expect(prompt).toMatch(/luxury modern interior/);
    expect(prompt).toMatch(/top-down architectural cutaway/);
    expect(prompt).toMatch(/warm dusk lighting/);
    expect(prompt).toMatch(/rooms: .*living room/);
    expect(prompt).toMatch(/flooring/);
    expect(prompt).toMatch(/photorealistic/);
    expect(negative).toBe(NEGATIVE_PROMPT);
    for (const w of ['text', 'watermark', 'distorted furniture', 'extra walls', 'blurry'])
      expect(negative).toContain(w);
  });

  it('changes with the preset, the look and the style', () => {
    const base = {
      project,
      preset: 'cutaway-top' as const,
      look: 'dusk' as const,
      style: 'modern-luxury' as const,
    };
    const a = buildPrompt(base).prompt;
    expect(buildPrompt({ ...base, preset: 'cutaway-34' }).prompt).toMatch(/three-quarter view/);
    expect(buildPrompt({ ...base, look: 'daylight' }).prompt).toMatch(/natural daylight/);
    for (const s of STYLE_PRESETS) {
      const p = buildPrompt({ ...base, style: s.id }).prompt;
      expect(p).toContain(s.keywords);
      if (s.id !== 'modern-luxury') expect(p).not.toBe(a);
    }
    expect(STYLE_PRESETS.map((s) => s.id)).toEqual([
      'modern-luxury',
      'warm-minimal',
      'classic',
      'tropical',
      'industrial',
    ]);
  });

  it('only describes the rooms of the levels in the picture, and mentions a pool for a villa', () => {
    const first = new Set([project.levels[0]!.id]);
    const p = buildPrompt({
      project,
      preset: null,
      look: 'night',
      style: 'classic',
      levelIds: first,
    }).prompt;
    expect(p).toMatch(/night scene/);
    const villa = produce(project, (d) => {
      d.site.zones.push({
        id: 'z',
        name: 'Pool',
        type: 'pool',
        polygon: [
          { x: 0, y: 0 },
          { x: 1, y: 0 },
          { x: 1, y: 1 },
        ],
        material: 'water',
        covered: false,
      });
    });
    expect(
      buildPrompt({ project: villa, preset: null, look: 'dusk', style: 'tropical' }).prompt,
    ).toMatch(/swimming pool/);
  });
});

describe('request schema', () => {
  const params = { prompt: 'a lovely room', seed: 1 };
  it('fills in the defaults and keeps creativity inside 0.1–0.6', () => {
    const p = EnhanceParamsSchema.parse(params);
    expect(p).toMatchObject({
      creativity: CREATIVITY_RANGE.default,
      controlStrength: 0.8,
      steps: 28,
      upscale: false,
      negative: '',
    });
    expect(CREATIVITY_RANGE).toMatchObject({ min: 0.1, max: 0.6, default: 0.35 });
    expect(EnhanceParamsSchema.safeParse({ ...params, creativity: 0.05 }).success).toBe(false);
    expect(EnhanceParamsSchema.safeParse({ ...params, creativity: 0.61 }).success).toBe(false);
    expect(EnhanceParamsSchema.safeParse({ ...params, seed: -1 }).success).toBe(false);
    expect(EnhanceParamsSchema.safeParse({ prompt: 'x', seed: 1 }).success).toBe(false);
  });

  it("needs the three pictures' camera and sensible sizes", () => {
    const png = 'data:image/png;base64,' + 'A'.repeat(40);
    const ok = {
      projectId: 'p',
      params: { prompt: 'a lovely room', seed: 1 },
      images: { color: png, depth: png },
      view: { viewProjection: new Array(16).fill(0), width: 1024, height: 768 },
    };
    expect(EnhanceRequestSchema.safeParse(ok).success).toBe(true);
    expect(
      EnhanceRequestSchema.safeParse({ ...ok, view: { ...ok.view, viewProjection: [1, 2] } })
        .success,
    ).toBe(false);
    expect(
      EnhanceRequestSchema.safeParse({ ...ok, view: { ...ok.view, width: 99999 } }).success,
    ).toBe(false);
    expect(EnhanceRequestSchema.safeParse({ ...ok, images: { color: png } }).success).toBe(false);
  });
});

describe('edge pass', () => {
  const size = 16;
  const flat = (v: number) => {
    const a = new Uint8ClampedArray(size * size * 4);
    for (let i = 0; i < a.length; i += 4) a.set([v, v, v, 255], i);
    return a;
  };
  it('draws lines where the surface direction or the distance changes, and nothing on a flat surface', () => {
    expect(
      computeEdges(size, size, flat(128), null).filter((v, i) => i % 4 === 0 && v > 0),
    ).toHaveLength(0);
    const step = flat(40);
    for (let y = 0; y < size; y++)
      for (let x = size / 2; x < size; x++) step.set([220, 220, 220, 255], (y * size + x) * 4);
    const edges = computeEdges(size, size, step, null);
    const at = (x: number, y: number) => edges[(y * size + x) * 4]!;
    expect(at(size / 2, 8)).toBe(255);
    expect(at(2, 8)).toBe(0);
    expect(at(size - 2, 8)).toBe(0);
    // A jump in depth alone is an edge too.
    const d = computeEdges(size, size, flat(128), step);
    expect(d[(8 * size + size / 2) * 4]).toBe(255);
  });
});
