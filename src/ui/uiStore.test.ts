import { describe, expect, it } from 'vitest';
import { useUiStore } from './uiStore';

describe('uiStore', () => {
  it('switches view mode', () => {
    useUiStore.getState().setViewMode('3d');
    expect(useUiStore.getState().viewMode).toBe('3d');
    useUiStore.getState().setViewMode('split');
  });
});
