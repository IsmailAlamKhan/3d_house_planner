import { usePlanStore } from '../plan2d/planStore';

/** Short messages (why an edit was refused, clearance warnings) shown over whichever view is open. */
export function Toaster() {
  const toast = usePlanStore((s) => s.toast);
  if (!toast) return null;
  return (
    <div
      role="status"
      className="pointer-events-none fixed bottom-12 left-1/2 z-50 max-w-[90vw] -translate-x-1/2 rounded-md bg-slate-900/90 px-3 py-2 text-center text-sm text-white shadow-lg"
    >
      {toast}
    </div>
  );
}
