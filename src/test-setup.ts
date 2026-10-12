import '@testing-library/jest-dom/vitest';

// jsdom has no ResizeObserver.
globalThis.ResizeObserver ??= class {
  observe() {}
  unobserve() {}
  disconnect() {}
};

// The first-run tour is for real users; tests start with it already seen.
import { usePrefs } from './prefs/prefsStore';
usePrefs.setState({ tourSeen: true });
