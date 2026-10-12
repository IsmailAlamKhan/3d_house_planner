import { describe, expect, it } from 'vitest';
import { getLanguage, t } from './index';

describe('i18n', () => {
  it('defaults to English', () => {
    expect(getLanguage()).toBe('en');
    expect(t('view.3d')).toBe('3D');
  });
});
