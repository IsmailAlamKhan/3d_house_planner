import { describe, expect, it } from 'vitest';
import { useUiStore } from './uiStore';

describe('uiStore', () => {
  it('switches left tab', () => {
    useUiStore.getState().setLeftTab('levels');
    expect(useUiStore.getState().leftTab).toBe('levels');
  });
});
