import { create } from 'zustand';

/** The browser's "install this app" offer (Chromium fires it once the app qualifies). */
interface InstallEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

interface PwaState {
  installEvent: InstallEvent | null;
  offlineReady: boolean;
  needRefresh: boolean;
  /** Applies the waiting service worker and reloads. */
  update: (() => void) | null;
  dismiss: () => void;
  install: () => Promise<void>;
}

export const usePwa = create<PwaState>((set, get) => ({
  installEvent: null,
  offlineReady: false,
  needRefresh: false,
  update: null,
  dismiss: () => set({ offlineReady: false, needRefresh: false }),
  install: async () => {
    const e = get().installEvent;
    if (!e) return;
    await e.prompt();
    await e.userChoice;
    set({ installEvent: null });
  },
}));

/** Registers the service worker and listens for the install offer. Call once at startup. */
export async function initPwa(): Promise<void> {
  if (typeof window === 'undefined') return;
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    usePwa.setState({ installEvent: e as InstallEvent });
  });
  window.addEventListener('appinstalled', () => usePwa.setState({ installEvent: null }));
  if (!('serviceWorker' in navigator)) return;
  try {
    const { registerSW } = await import('virtual:pwa-register');
    const update = registerSW({
      onNeedRefresh: () => usePwa.setState({ needRefresh: true }),
      onOfflineReady: () => usePwa.setState({ offlineReady: true }),
    });
    usePwa.setState({ update: () => void update(true) });
  } catch (e) {
    console.warn('Offline support could not be started', e);
  }
}
