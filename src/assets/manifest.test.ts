import { describe, expect, it } from 'vitest';
import { CATALOG } from '../catalog';
import { getMaterialDef } from '../materials/library';
import { ALLOWED_LICENSES, ManifestSchema, manifestProblems } from './manifest';
import licensesText from '../../assets/LICENSES.md?raw';
import manifestText from '../../assets/manifest.json?raw';
import { sizeMismatch } from './pack';

const manifest = ManifestSchema.parse(JSON.parse(manifestText));
const models = manifest.assets.flatMap((a) => (a.kind === 'model' ? [a] : []));

describe('asset manifest', () => {
  it('is valid and has no unlawful or unusable entries', () => {
    expect(manifestProblems(manifest)).toEqual([]);
  });

  it('allows only CC0 and every asset states it with a licence page', () => {
    expect(ALLOWED_LICENSES).toEqual(['CC0-1.0']);
    for (const a of manifest.assets) {
      expect(a.license, a.id).toBe('CC0-1.0');
      expect(a.licenseUrl, a.id).toMatch(/^https:\/\//);
      expect(a.author.length, a.id).toBeGreaterThan(0);
    }
  });

  it('has a pinned hash for every download', () => {
    for (const a of manifest.assets) expect(a.source.sha256, a.id).toMatch(/^[a-f0-9]{64}$/);
  });

  it('covers every asset in LICENSES.md', () => {
    for (const a of manifest.assets) expect(licensesText, a.id).toContain(`| ${a.id} |`);
    expect(licensesText).toContain(`${manifest.assets.length} assets`);
  });

  it('points every model at a catalogue item (one model per item) and every texture at a library material', () => {
    const ids = models.map((m) => m.catalogId);
    expect(new Set(ids).size).toBe(ids.length);
    for (const m of models)
      expect(
        CATALOG.find((c) => c.catalogId === m.catalogId),
        m.id,
      ).toBeDefined();
    for (const a of manifest.assets)
      if (a.kind === 'texture') expect(getMaterialDef(a.materialId), a.id).toBeDefined();
  });

  it("sizes every model to its catalogue item's default size (within 5 %)", () => {
    for (const m of models) {
      const entry = CATALOG.find((c) => c.catalogId === m.catalogId)!;
      expect(sizeMismatch({ ...m, file: '' }, entry), m.id).toBeLessThan(0.05);
    }
  });

  it('has a sky for each of day, dusk and night', () => {
    const presets = manifest.assets.flatMap((a) => (a.kind === 'hdri' ? [a.preset] : [])).sort();
    expect(presets).toEqual(['day', 'dusk', 'night']);
  });
});
