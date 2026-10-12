import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import { useCatalogDrag } from './dragStore';
import { DND_MIME, LibraryPanel } from './LibraryPanel';

beforeEach(() => {
  useCatalogDrag.setState({ dragId: null, armedId: null, hover: null });
});

describe('LibraryPanel', () => {
  it('lists doors by default, switches category and searches across all', () => {
    render(<LibraryPanel />);
    expect(screen.getByTestId('lib-door-single')).toBeInTheDocument();
    expect(screen.queryByTestId('lib-sofa-3seat')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('tab', { name: 'Living' }));
    expect(screen.getByTestId('lib-sofa-3seat')).toBeInTheDocument();
    fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'bath' } });
    expect(screen.getByTestId('lib-bathtub')).toBeInTheDocument();
    expect(screen.queryByTestId('lib-sofa-3seat')).not.toBeInTheDocument();
    fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'zzzz' } });
    expect(screen.getByText(/Nothing matches/)).toBeInTheDocument();
  });

  it('tapping a card arms it (and tapping again disarms); dragging sets the drag id and payload', () => {
    render(<LibraryPanel />);
    const card = screen.getByTestId('lib-door-single');
    fireEvent.click(card);
    expect(useCatalogDrag.getState().armedId).toBe('door-single');
    expect(screen.getByRole('status')).toHaveTextContent(/place the single door/i);
    fireEvent.click(card);
    expect(useCatalogDrag.getState().armedId).toBeNull();

    const data: Record<string, string> = {};
    fireEvent.dragStart(card, {
      dataTransfer: { setData: (k: string, v: string) => (data[k] = v), effectAllowed: '' },
    });
    expect(data[DND_MIME]).toBe('door-single');
    expect(useCatalogDrag.getState().dragId).toBe('door-single');
    fireEvent.dragEnd(card);
    expect(useCatalogDrag.getState().dragId).toBeNull();
  });
});
