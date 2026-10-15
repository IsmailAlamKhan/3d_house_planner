import { useEffect, useLayoutEffect, useState } from 'react';
import { type TranslationKey, useT } from '../i18n';
import { useModel } from '../model/store';
import { usePrefs } from '../prefs/prefsStore';
import { type LeftTab, useUiStore } from '../ui/uiStore';
import { endTour, useTour } from './tourStore';

interface Step {
  /** `data-tour` value of the element to point at (none = centred welcome card). */
  target?: string;
  title: TranslationKey;
  body: TranslationKey;
  /** Gets the screen into the state the step talks about. */
  before?: () => void;
}

const isNarrow = () => typeof window !== 'undefined' && window.innerWidth < 1024;

const showLeft = (tab: LeftTab) => () => {
  const ui = useUiStore.getState();
  ui.setLeftTab(tab);
  ui.setRightDrawerOpen(false);
  ui.setLeftDrawerOpen(isNarrow());
};
const showRight = () => {
  const ui = useUiStore.getState();
  ui.setLeftDrawerOpen(false);
  ui.setRightDrawerOpen(isNarrow());
};
const closeDrawers = () => {
  const ui = useUiStore.getState();
  ui.setLeftDrawerOpen(false);
  ui.setRightDrawerOpen(false);
};
const showView = (mode: 'split' | 'keep') => () => {
  closeDrawers();
  const m = useModel.getState();
  if (mode === 'split' && m.viewMode !== 'split') m.setViewMode('split');
};

export const TOUR_STEPS: Step[] = [
  { title: 'tour.1.title', body: 'tour.1.body', before: closeDrawers },
  { target: 'tab-ai', title: 'tour.9.title', body: 'tour.9.body', before: showLeft('ai') },
  { target: 'projects', title: 'tour.2.title', body: 'tour.2.body', before: closeDrawers },
  { target: 'plan-tools', title: 'tour.3.title', body: 'tour.3.body', before: showView('split') },
  {
    target: 'tab-library',
    title: 'tour.4.title',
    body: 'tour.4.body',
    before: showLeft('library'),
  },
  { target: 'properties', title: 'tour.5.title', body: 'tour.5.body', before: showRight },
  { target: 'camera-modes', title: 'tour.6.title', body: 'tour.6.body', before: showView('split') },
  { target: 'tab-checks', title: 'tour.7.title', body: 'tour.7.body', before: showLeft('checks') },
  { target: 'export', title: 'tour.8.title', body: 'tour.8.body', before: closeDrawers },
];

/** The first visible element carrying `data-tour="name"` (the sidebars exist twice: docked and in a drawer). */
function findTarget(name: string): HTMLElement | null {
  const all = document.querySelectorAll<HTMLElement>(`[data-tour="${name}"]`);
  for (const el of all) {
    const r = el.getBoundingClientRect();
    if (r.width > 0 && r.height > 0) return el;
  }
  return null;
}

interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

/**
 * Interactive first-run tour: a spotlight on the part of the screen each step talks about, with Next / Back / Skip.
 * It never blocks the app — the highlighted control can be used while the card is open.
 */
export function TourOverlay() {
  const t = useT();
  const open = useTour((s) => s.open);
  const step = useTour((s) => s.step);
  const setStep = useTour((s) => s.setStep);
  const tourSeen = usePrefs((s) => s.tourSeen);
  const [box, setBox] = useState<Box | null>(null);
  const [viewport, setViewport] = useState({ w: 0, h: 0 });
  const current = TOUR_STEPS[step];

  // First run: offer the tour once everything has loaded.
  useEffect(() => {
    if (tourSeen) return;
    const id = setTimeout(() => {
      if (!usePrefs.getState().tourSeen) useTour.setState({ open: true, step: 0 });
    }, 1200);
    return () => clearTimeout(id);
  }, [tourSeen]);

  // Prepare the screen for this step.
  useEffect(() => {
    if (open) current?.before?.();
  }, [open, step, current]);

  // Follow the target (it may move while panels open, the window resizes, or the layout changes).
  useLayoutEffect(() => {
    if (!open) return;
    const measure = () => {
      setViewport({ w: window.innerWidth, h: window.innerHeight });
      const el = current?.target ? findTarget(current.target) : null;
      if (!el) return setBox(null);
      const r = el.getBoundingClientRect();
      setBox((old) =>
        old &&
        Math.abs(old.x - r.left) < 0.5 &&
        Math.abs(old.y - r.top) < 0.5 &&
        Math.abs(old.w - r.width) < 0.5 &&
        Math.abs(old.h - r.height) < 0.5
          ? old
          : { x: r.left, y: r.top, w: r.width, h: r.height },
      );
    };
    measure();
    const id = setInterval(measure, 250);
    window.addEventListener('resize', measure);
    return () => {
      clearInterval(id);
      window.removeEventListener('resize', measure);
    };
  }, [open, current]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !document.querySelector('[aria-modal="true"]')) endTour();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);

  if (!open || !current) return null;
  const last = step === TOUR_STEPS.length - 1;
  const pad = 6;
  const sheet = viewport.w < 640;
  const cardW = Math.min(360, viewport.w - 24);
  let left = Math.max(12, (viewport.w - cardW) / 2);
  let top = Math.max(12, viewport.h / 2 - 100);
  if (box && !sheet) {
    left = Math.min(Math.max(12, box.x + box.w / 2 - cardW / 2), viewport.w - cardW - 12);
    const below = box.y + box.h + pad + 12;
    top = below + 190 < viewport.h ? below : Math.max(12, box.y - pad - 12 - 190);
    // A tall target (a whole sidebar) leaves no room above or below: put the card beside it.
    if (box.h > viewport.h * 0.6) {
      const rightSide = box.x + box.w + 12;
      left = rightSide + cardW < viewport.w ? rightSide : Math.max(12, box.x - cardW - 12);
      top = Math.max(12, Math.min(viewport.h - 220, box.y + 40));
    }
  }

  return (
    <div className="pointer-events-none fixed inset-0 z-[60]" data-testid="tour">
      {box ? (
        <div
          aria-hidden
          className="absolute rounded-lg ring-2 ring-sky-400 transition-all duration-200"
          style={{
            left: box.x - pad,
            top: box.y - pad,
            width: box.w + pad * 2,
            height: box.h + pad * 2,
            boxShadow: '0 0 0 9999px rgba(0,0,0,0.45)',
          }}
        />
      ) : (
        <div aria-hidden className="absolute inset-0 bg-black/45" />
      )}
      <div
        role="dialog"
        aria-label={`${t('tour.title')}: ${t(current.title)}`}
        aria-live="polite"
        className={`anim-panel pointer-events-auto absolute rounded-xl bg-white p-4 text-slate-800 shadow-2xl ${sheet ? 'inset-x-3 bottom-3' : ''}`}
        style={sheet ? undefined : { left, top, width: cardW }}
      >
        <p className="text-xs font-medium text-sky-700">
          {t('tour.step')
            .replace('{n}', String(step + 1))
            .replace('{total}', String(TOUR_STEPS.length))}
        </p>
        <h2 className="mt-1 text-base font-semibold">{t(current.title)}</h2>
        <p className="mt-1 text-sm text-slate-600">{t(current.body)}</p>
        <div className="mt-3 flex items-center gap-2">
          <button
            className="rounded-md px-2 py-1 text-sm text-slate-600 hover:bg-slate-100"
            onClick={endTour}
          >
            {t('tour.skip')}
          </button>
          <span className="flex-1" />
          {step > 0 && (
            <button
              className="rounded-md border border-slate-300 px-3 py-1 text-sm hover:bg-slate-100"
              onClick={() => setStep(step - 1)}
            >
              {t('tour.back')}
            </button>
          )}
          <button
            data-autofocus
            autoFocus
            className="rounded-md bg-sky-700 px-3 py-1 text-sm text-white hover:bg-sky-800"
            onClick={() => (last ? endTour() : setStep(step + 1))}
          >
            {last ? t('tour.done') : t('tour.next')}
          </button>
        </div>
      </div>
    </div>
  );
}
