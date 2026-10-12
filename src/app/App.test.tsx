import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

vi.mock('../scene3d/SceneCanvas', () => ({
  SceneCanvas: () => <div data-testid="scene-canvas" />,
}));

import { App } from './App';

describe('App shell', () => {
  it('switches between 2D, 3D and split views', () => {
    render(<App />);
    expect(screen.getByTestId('plan-canvas')).toBeInTheDocument();
    expect(screen.getByTestId('scene-canvas')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '3D' }));
    expect(screen.queryByTestId('plan-canvas')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '2D' }));
    expect(screen.queryByTestId('scene-canvas')).not.toBeInTheDocument();
  });
});
