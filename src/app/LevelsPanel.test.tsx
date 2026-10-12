import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import { createSampleProject } from '../model/sample';
import { undo, useModel } from '../model/store';
import { LevelsPanel } from './LevelsPanel';

describe('LevelsPanel', () => {
  beforeEach(() => useModel.getState().loadProject(createSampleProject()));

  it('lists levels, sets active, toggles visibility and adds a level (undoable)', () => {
    render(<LevelsPanel />);
    expect(screen.getByText(/Upper floor/)).toBeInTheDocument();
    fireEvent.click(screen.getByLabelText(/Active level: Upper floor/));
    expect(useModel.getState().activeLevelId).toBe(useModel.getState().project.levels[1]!.id);
    fireEvent.click(screen.getAllByLabelText('Hide level')[0]!);
    expect(useModel.getState().project.levels[1]!.visible).toBe(false);
    fireEvent.click(screen.getByText('Add level'));
    expect(useModel.getState().project.levels).toHaveLength(3);
    undo();
    expect(useModel.getState().project.levels).toHaveLength(2);
  });
});
