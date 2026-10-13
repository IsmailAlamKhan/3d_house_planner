import { describe, expect, it } from 'vitest';
import {
  PRESET_TIME,
  formatTime,
  interiorLightsOn,
  moonAt,
  skyFor,
  sunAt,
  sunVisible,
  timeOf,
} from './lighting';
import { QUALITY, detectQuality } from './quality';

const deg = (r: number) => (r * 180) / Math.PI;

describe('sun', () => {
  it('rises in the east, is due south at 13:00 and sets in the west (building facing north)', () => {
    const rise = sunAt(6, 0);
    const noon = sunAt(13, 0);
    const set = sunAt(20, 0);
    expect(rise.direction[0]).toBeGreaterThan(0.9); // east = +x
    expect(noon.direction[2]).toBeGreaterThan(0.2); // south = +z (plan down)
    expect(Math.abs(noon.direction[0])).toBeLessThan(1e-6);
    expect(set.direction[0]).toBeLessThan(-0.9);
    expect(deg(noon.elevation)).toBeCloseTo(62);
    expect(deg(rise.elevation)).toBeCloseTo(0);
  });

  it('is a unit vector and moves smoothly through the day', () => {
    let prev = sunAt(6, 0).direction;
    for (let t = 6.5; t <= 20; t += 0.5) {
      const d = sunAt(t, 0).direction;
      expect(Math.hypot(...d)).toBeCloseTo(1);
      expect(Math.hypot(d[0] - prev[0], d[1] - prev[1], d[2] - prev[2])).toBeLessThan(0.4);
      prev = d;
    }
  });

  it('shadows move: the sun direction changes noticeably between morning and afternoon', () => {
    const a = sunAt(9, 0).direction;
    const b = sunAt(16, 0).direction;
    expect(a[0]).toBeGreaterThan(0.2);
    expect(b[0]).toBeLessThan(-0.2);
  });

  it('turning the building changes where the sun is relative to the plan', () => {
    const north = sunAt(13, 0).direction;
    const turned = sunAt(13, 90).direction; // plan "up" now faces east → the south sun appears on the plan's left/right edge
    expect(Math.abs(north[0])).toBeLessThan(1e-6);
    expect(Math.abs(turned[0])).toBeGreaterThan(0.3);
    expect(Math.abs(turned[2])).toBeLessThan(1e-6 + 0.0001);
  });

  it('is brightest at noon and warm when low', () => {
    expect(sunAt(13, 0).intensity).toBeGreaterThan(sunAt(7, 0).intensity);
    const low = parseInt(sunAt(19.5, 0).color.slice(1, 3), 16);
    const lowBlue = parseInt(sunAt(19.5, 0).color.slice(5, 7), 16);
    expect(low).toBeGreaterThan(lowBlue + 40); // orange tint
  });

  it('night uses a weak blue moon', () => {
    const moon = moonAt(0);
    expect(moon.intensity).toBeLessThan(0.4);
    expect(moon.color).toBe('#8da5ff');
  });
});

describe('presets', () => {
  it('maps presets to times; evening and night switch interior lights on, morning and noon do not', () => {
    expect(timeOf({ mode: 'morning', time: 12 })).toBe(PRESET_TIME.morning);
    expect(timeOf({ mode: 'custom', time: 15.5 })).toBe(15.5);
    expect(interiorLightsOn({ mode: 'night', time: 0 })).toBe(true);
    expect(interiorLightsOn({ mode: 'evening', time: 0 })).toBe(true);
    expect(interiorLightsOn({ mode: 'marketing', time: 0 })).toBe(true);
    expect(interiorLightsOn({ mode: 'noon', time: 0 })).toBe(false);
    expect(interiorLightsOn({ mode: 'morning', time: 0 })).toBe(false);
    expect(interiorLightsOn({ mode: 'custom', time: 19 })).toBe(true);
    expect(interiorLightsOn({ mode: 'custom', time: 12 })).toBe(false);
    expect(sunVisible({ mode: 'night', time: 0 })).toBe(false);
  });

  it('sky is darker at night than at noon', () => {
    const noon = skyFor({ mode: 'noon', time: 13 }, sunAt(13, 0));
    const night = skyFor({ mode: 'night', time: 22 }, moonAt(0));
    expect(night.ambient).toBeLessThan(noon.ambient);
    expect(night.top).not.toBe(noon.top);
  });

  it('formats clock times', () => {
    expect(formatTime(8)).toBe('08:00');
    expect(formatTime(13.5)).toBe('13:30');
    expect(formatTime(19.999)).toBe('20:00');
  });
});

describe('quality', () => {
  it('Low drops shadows/AA, High adds AO', () => {
    expect(QUALITY.low.shadows).toBe(false);
    expect(QUALITY.low.antialias).toBe(false);
    expect(QUALITY.medium.ao).toBe(false);
    expect(QUALITY.high.ao).toBe(true);
    expect(QUALITY.high.maxLights).toBeGreaterThan(QUALITY.low.maxLights);
    expect(QUALITY.high.dpr[1]).toBeGreaterThan(QUALITY.medium.dpr[1]);
  });

  it('auto-selects from the device', () => {
    const base = { cores: 8, memory: 8, touch: false, screenMin: 1080 };
    expect(
      detectQuality({ ...base, renderer: 'ANGLE (Google, Vulkan 1.3.0 (SwiftShader Device))' }),
    ).toBe('low');
    expect(detectQuality({ ...base, renderer: 'ANGLE (NVIDIA, NVIDIA GeForce RTX 4060 Ti)' })).toBe(
      'high',
    );
    expect(detectQuality({ ...base, renderer: 'ANGLE (Apple, Apple M2)' })).toBe('high');
    expect(detectQuality({ ...base, cores: 4, renderer: 'ANGLE (Apple, Apple M1)' })).toBe(
      'medium',
    );
    expect(detectQuality({ ...base, renderer: 'ANGLE (Intel, Intel(R) UHD Graphics 620)' })).toBe(
      'medium',
    );
    expect(detectQuality({ ...base, touch: true, screenMin: 390, renderer: 'Apple GPU' })).toBe(
      'low',
    );
    expect(detectQuality({ ...base, cores: 2, renderer: 'whatever' })).toBe('low');
    expect(detectQuality({ ...base, renderer: '' })).toBe('medium');
  });
});
