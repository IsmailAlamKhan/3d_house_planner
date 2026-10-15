import { useRef, useState } from 'react';
import { useT } from '../i18n';
import { Modal } from '../ui/Modal';
import { useCopilot } from './copilotStore';
import type { SketchBox } from './sketch';

interface Drawn extends SketchBox {
  id: number;
}

/** Draw rough room boxes (drag on the canvas, name each one) or upload a photo of a hand-drawn plan. */
export function SketchDialog({ onClose }: { onClose: () => void }) {
  const t = useT();
  const fromBoxes = useCopilot((s) => s.fromSketchBoxes);
  const fromPhoto = useCopilot((s) => s.fromSketchPhoto);
  const busy = useCopilot((s) => s.busy);
  const [boxes, setBoxes] = useState<Drawn[]>([]);
  const [draft, setDraft] = useState<{ x: number; y: number; w: number; h: number } | null>(null);
  const area = useRef<HTMLDivElement>(null);
  const start = useRef<{ x: number; y: number } | null>(null);
  const next = useRef(1);

  const norm = (e: React.PointerEvent) => {
    const r = area.current!.getBoundingClientRect();
    return {
      x: Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)),
      y: Math.min(1, Math.max(0, (e.clientY - r.top) / r.height)),
    };
  };

  const onPhoto = async (file: File | undefined) => {
    if (!file) return;
    const bmp = await createImageBitmap(file);
    const k = Math.min(1, 1600 / Math.max(bmp.width, bmp.height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(bmp.width * k);
    canvas.height = Math.round(bmp.height * k);
    canvas.getContext('2d')!.drawImage(bmp, 0, 0, canvas.width, canvas.height);
    await fromPhoto(canvas);
    onClose();
  };

  return (
    <Modal
      open
      onClose={onClose}
      label={t('copilot.sketch.title')}
      className="max-w-lg"
      placement="sheet"
    >
      <div className="space-y-3 p-4 text-sm">
        <h2 className="font-semibold">{t('copilot.sketch.title')}</h2>
        <p className="text-xs text-slate-600">{t('copilot.sketch.help')}</p>
        <div
          ref={area}
          data-testid="sketch-canvas"
          className="relative aspect-[4/3] w-full touch-none rounded border border-slate-300 bg-white"
          onPointerDown={(e) => {
            (e.target as Element).setPointerCapture?.(e.pointerId);
            start.current = norm(e);
            setDraft({ ...start.current, w: 0, h: 0 });
          }}
          onPointerMove={(e) => {
            if (!start.current) return;
            const p = norm(e);
            setDraft({
              x: Math.min(start.current.x, p.x),
              y: Math.min(start.current.y, p.y),
              w: Math.abs(p.x - start.current.x),
              h: Math.abs(p.y - start.current.y),
            });
          }}
          onPointerUp={() => {
            if (draft && draft.w > 0.04 && draft.h > 0.04)
              setBoxes((b) => [...b, { ...draft, id: next.current++, name: '' }]);
            start.current = null;
            setDraft(null);
          }}
        >
          {[...boxes, ...(draft ? [{ ...draft, id: 0, name: '' }] : [])].map((b) => (
            <div
              key={b.id}
              className="absolute border-2 border-sky-600 bg-sky-100/60"
              style={{
                left: `${b.x * 100}%`,
                top: `${b.y * 100}%`,
                width: `${b.w * 100}%`,
                height: `${b.h * 100}%`,
              }}
            >
              {b.id > 0 && (
                <input
                  aria-label={t('copilot.sketch.name')}
                  placeholder={t('copilot.sketch.name')}
                  value={b.name}
                  onPointerDown={(e) => e.stopPropagation()}
                  onChange={(e) =>
                    setBoxes((all) =>
                      all.map((x) => (x.id === b.id ? { ...x, name: e.target.value } : x)),
                    )
                  }
                  className="absolute inset-x-0 top-0 w-full bg-white/80 px-1 text-[11px]"
                />
              )}
            </div>
          ))}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button
            disabled={busy || boxes.length < 2}
            onClick={() => {
              void fromBoxes(
                boxes.map((b) => ({ name: b.name || 'Room', x: b.x, y: b.y, w: b.w, h: b.h })),
              );
              onClose();
            }}
            className="rounded bg-sky-700 px-3 py-1.5 text-sm font-medium text-white hover:bg-sky-800 disabled:opacity-50"
          >
            {t('copilot.sketch.use')}
          </button>
          <button
            disabled={!boxes.length}
            onClick={() => setBoxes((b) => b.slice(0, -1))}
            className="rounded border border-slate-300 px-2 py-1 text-xs"
          >
            {t('copilot.sketch.undo')}
          </button>
          <label className="ml-auto cursor-pointer rounded border border-slate-300 px-2 py-1 text-xs hover:bg-slate-50">
            {t('copilot.sketch.photo')}
            <input
              type="file"
              accept="image/*"
              className="sr-only"
              disabled={busy}
              onChange={(e) => void onPhoto(e.target.files?.[0])}
            />
          </label>
        </div>
      </div>
    </Modal>
  );
}
