import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { MaterialPicker } from './MaterialPicker';

describe('MaterialPicker', () => {
  it('shows the current material, opens a swatch grid per category and reports the pick', () => {
    const onPick = vi.fn();
    render(
      <MaterialPicker label="Floor" value="floor-oak" categories={['floor']} onPick={onPick} />,
    );
    const header = screen.getByRole('button', { name: 'Floor: Light oak planks' });
    expect(screen.queryByRole('button', { name: 'Grey tiles' })).not.toBeInTheDocument();
    fireEvent.click(header);
    expect(screen.getByRole('button', { name: 'Light oak planks' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    fireEvent.click(screen.getByRole('button', { name: 'Grey tiles' }));
    expect(onPick).toHaveBeenCalledWith('floor-tile-grey');
  });

  it('offers "default" when clearable, paint colours for walls and shortcut buttons', () => {
    const onClear = vi.fn();
    render(
      <MaterialPicker
        label="Main surface"
        value={null}
        categories={['surface', 'floor']}
        onPick={() => {}}
        onClear={onClear}
        customPaint
      >
        <button>Same for the whole level</button>
      </MaterialPicker>,
    );
    expect(screen.getByRole('button', { name: 'Main surface: Default' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Main surface: Default' }));
    fireEvent.click(screen.getAllByRole('button', { name: 'Default' }).at(-1)!);
    expect(onClear).toHaveBeenCalled();
    expect(screen.getByText('Surfaces')).toBeInTheDocument();
    expect(screen.getByText('Floors')).toBeInTheDocument();
    expect(screen.getByText('Any paint colour')).toBeInTheDocument();
    expect(screen.getByText('Same for the whole level')).toBeInTheDocument();
  });

  it('marks mixed selections', () => {
    render(
      <MaterialPicker
        label="Inside finish"
        value={undefined}
        categories={['wall']}
        onPick={() => {}}
      />,
    );
    expect(screen.getByRole('button', { name: 'Inside finish: Mixed' })).toBeInTheDocument();
  });
});
