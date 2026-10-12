import { describe, expect, it } from 'vitest';
import { formatArea, formatLength, parseLength } from './units';

describe('units', () => {
  it('formats lengths and areas', () => {
    expect(formatLength(3.456, 'metric')).toBe('3.46 m');
    expect(formatLength(3.4544, 'imperial')).toBe('11′ 4″');
    expect(formatArea(12, 'metric')).toBe('12.0 m²');
    expect(formatArea(12, 'imperial')).toBe('129 ft²');
  });
  it('parses typed lengths', () => {
    expect(parseLength('3.5', 'metric')).toBe(3.5);
    expect(parseLength('3,5', 'metric')).toBe(3.5);
    expect(parseLength('350cm', 'metric')).toBeCloseTo(3.5);
    expect(parseLength('10', 'imperial')).toBeCloseTo(3.048);
    expect(parseLength(`10'6"`, 'imperial')).toBeCloseTo(3.2004);
    expect(parseLength("10' 6", 'imperial')).toBeCloseTo(3.2004);
    expect(parseLength('abc', 'metric')).toBeNull();
    expect(parseLength('', 'metric')).toBeNull();
  });
});
