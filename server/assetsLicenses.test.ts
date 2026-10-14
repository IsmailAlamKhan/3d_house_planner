import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { licensesMarkdown } from '../scripts/assets-licenses';

describe('assets/LICENSES.md', () => {
  it('is generated from the manifest and up to date (run npm run assets:licenses after changing it)', () => {
    const expected = licensesMarkdown(readFileSync('assets/manifest.json', 'utf8'));
    expect(readFileSync('assets/LICENSES.md', 'utf8').replace(/\r\n/g, '\n')).toBe(expected);
  });
});
