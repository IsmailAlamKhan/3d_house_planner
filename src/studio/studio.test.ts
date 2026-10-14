import { describe, expect, it } from 'vitest';
import { PRESET_TIME } from '../scene3d/lighting';
import { environmentFor } from './bundle';
import { QUALITY_PRESETS, STUDIO_QUALITIES, StudioSidecarSchema } from './protocol';

describe('studio quality presets', () => {
  it('Preview ~64 samples at 1280 px, Standard 256 at 1920, Poster 1024 at 3840', () => {
    expect(STUDIO_QUALITIES).toEqual(['preview', 'standard', 'poster']);
    expect(QUALITY_PRESETS.preview).toEqual({ samples: 64, longSide: 1280 });
    expect(QUALITY_PRESETS.standard).toEqual({ samples: 256, longSide: 1920 });
    expect(QUALITY_PRESETS.poster).toEqual({ samples: 1024, longSide: 3840 });
  });
});

describe('studio environment', () => {
  it('dusk and night are lit by the sky (no sun lamp), the day gets a sun', () => {
    const dusk = environmentFor({ mode: 'dusk', time: PRESET_TIME.dusk }, 0, 0);
    expect(dusk.hdri).toBe('dusk');
    expect(dusk.sun.strength).toBe(0);
    const night = environmentFor({ mode: 'night', time: PRESET_TIME.night }, 0, 0);
    expect(night.hdri).toBe('night');
    expect(night.sun.strength).toBe(0);
    const noon = environmentFor({ mode: 'noon', time: PRESET_TIME.noon }, 0, 1);
    expect(noon.hdri).toBe('day');
    expect(noon.sun.strength).toBeGreaterThan(1);
    expect(noon.exposure).toBe(1);
  });
});

describe('studio sidecar', () => {
  const base = {
    version: 1,
    projectId: 'p',
    projectName: 'P',
    output: { width: 1280, height: 960 },
    camera: { matrixWorld: new Array(16).fill(0), kind: 'perspective' },
    environment: {
      hdri: 'day',
      sun: { direction: [0, 1, 0], color: '#fff', strength: 3 },
    },
    cutaway: { enabled: false },
    lights: { lamps: [], windows: [] },
  };

  it('accepts a minimal bundle and fills the defaults', () => {
    const s = StudioSidecarSchema.parse(base);
    expect(s.camera.fov).toBe(45);
    expect(s.environment.hdriStrength).toBe(1);
    expect(s.glare).toBe(false);
  });

  it('rejects a bad camera matrix, an unknown sky or an absurd picture size', () => {
    expect(
      StudioSidecarSchema.safeParse({ ...base, camera: { ...base.camera, matrixWorld: [1] } })
        .success,
    ).toBe(false);
    expect(
      StudioSidecarSchema.safeParse({
        ...base,
        environment: { ...base.environment, hdri: 'space' },
      }).success,
    ).toBe(false);
    expect(
      StudioSidecarSchema.safeParse({ ...base, output: { width: 100000, height: 10 } }).success,
    ).toBe(false);
  });
});
