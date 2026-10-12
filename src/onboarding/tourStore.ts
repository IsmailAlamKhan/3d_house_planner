import { create } from 'zustand';
import { usePrefs } from '../prefs/prefsStore';

interface TourState {
  open: boolean;
  step: number;
  setStep: (n: number) => void;
}

export const useTour = create<TourState>((set) => ({
  open: false,
  step: 0,
  setStep: (step) => set({ step }),
}));

/** Starts (or restarts) the tour from the first step. */
export function startTour(): void {
  useTour.setState({ open: true, step: 0 });
}

/** Ends the tour and remembers that it was seen, so it does not start by itself again. */
export function endTour(): void {
  useTour.setState({ open: false, step: 0 });
  usePrefs.getState().set({ tourSeen: true });
}
