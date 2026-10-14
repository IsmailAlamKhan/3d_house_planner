import { ImageUp } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { useT } from '../../i18n';
import { useRecreate } from './recreateStore';

/** The picture-reading model's state according to the server (`/api/health`): installed, still downloading, or no server. */
function useVisionHealth(): { model: string; installed: boolean } | null {
  const [h, setH] = useState<{ model: string; installed: boolean } | null>(null);
  useEffect(() => {
    let stop = false;
    const check = async () => {
      try {
        const j = (await (
          await fetch('/api/health', { signal: AbortSignal.timeout(3000) })
        ).json()) as {
          vision?: { model: string; installed: boolean };
        };
        if (!stop) setH(j.vision ?? null);
      } catch {
        if (!stop) setH(null);
      }
    };
    void check();
    const id = setInterval(() => void check(), 15_000);
    return () => {
      stop = true;
      clearInterval(id);
    };
  }, []);
  return h;
}

/** "Recreate from picture": choose a picture; the dialog does the rest. */
export function RecreatePanel() {
  const tt = useT();
  const choose = useRecreate((s) => s.choose);
  const error = useRecreate((s) => s.error);
  const input = useRef<HTMLInputElement>(null);
  const vision = useVisionHealth();
  return (
    <div className="space-y-3">
      <p className="text-xs text-slate-600">{tt('vision.intro')}</p>
      {vision && !vision.installed && (
        <p
          role="status"
          data-testid="vision-missing"
          className="rounded bg-sky-50 p-2 text-xs text-sky-800"
        >
          {tt('vision.modelMissing').replace('{model}', vision.model)}
        </p>
      )}
      {!vision && (
        <p role="status" className="rounded bg-amber-50 p-2 text-xs text-amber-800">
          {tt('vision.unavailable')}
        </p>
      )}
      <input
        ref={input}
        type="file"
        accept="image/png,image/jpeg,image/webp"
        aria-label={tt('vision.choose')}
        data-testid="recreate-file"
        className="sr-only"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) void choose(f);
          e.target.value = '';
        }}
      />
      <button
        onClick={() => input.current?.click()}
        className="flex w-full items-center justify-center gap-1 rounded-md bg-sky-700 px-3 py-1.5 font-medium text-white hover:bg-sky-800"
      >
        <ImageUp size={14} /> {tt('vision.choose')}
      </button>
      {error && (
        <p role="alert" className="rounded bg-red-50 p-2 text-xs text-red-700">
          {error}
        </p>
      )}
    </div>
  );
}
