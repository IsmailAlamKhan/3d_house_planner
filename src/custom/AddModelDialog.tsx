import { useMemo, useState } from 'react';
import type { Object3D } from 'three';
import { toast } from '../catalog/actions';
import { renderThumbnail } from '../catalog/thumbnails';
import { CATEGORIES, type CatalogCategory } from '../catalog/types';
import { type TranslationKey, t, tf, useT } from '../i18n';
import { Modal } from '../ui/Modal';
import { previewEntry } from './entries';
import { type ModelSize, measureModel, parseGlb } from './glb';
import { useCustomAssets } from './store';

const field = 'w-full rounded-md border border-slate-300 px-2 py-1 text-sm';
const label = 'block text-xs font-medium text-slate-600';
const btn = 'rounded-md border border-slate-300 px-3 py-1.5 text-sm hover:bg-slate-50';
const primary =
  'rounded-md bg-sky-700 px-3 py-1.5 text-sm font-medium text-white hover:bg-sky-800 disabled:opacity-50';

/** Models are in metres by the glTF standard, but many are exported in cm or mm: guess, the user can correct it. */
export function guessUnitFactor(raw: ModelSize): number {
  const m = Math.max(raw.w, raw.h, raw.d);
  if (m > 500) return 0.001;
  if (m > 20) return 0.01;
  if (m > 0 && m < 0.02) return 100;
  return 1;
}

const r3 = (v: number) => Math.round(v * 1000) / 1000;
const SHOWN = CATEGORIES.filter((c) => c !== 'doors' && c !== 'windows');

/** Dialog: pick a .glb, name it, say how big it really is and where it belongs. */
export function AddModelDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  // Mounted only while open, so every opening starts with a clean form.
  return open ? <AddModelBody onClose={onClose} /> : null;
}

function AddModelBody({ onClose }: { onClose: () => void }) {
  const tt = useT();
  const add = useCustomAssets((s) => s.add);
  const [file, setFile] = useState<File | null>(null);
  const [root, setRoot] = useState<Object3D | null>(null);
  const [size, setSize] = useState({ w: 1, d: 1, h: 1 });
  const [ratio, setRatio] = useState({ w: 1, d: 1 }); // width and depth relative to the height
  const [keep, setKeep] = useState(true);
  const [name, setName] = useState('');
  const [category, setCategory] = useState<CatalogCategory>('custom');
  const [placement, setPlacement] = useState<'floor' | 'wall-mounted'>('floor');
  const [mount, setMount] = useState(1.4);
  const [state, setState] = useState<'idle' | 'reading' | 'saving'>('idle');
  const [error, setError] = useState('');

  const choose = async (f: File | undefined) => {
    setError('');
    setRoot(null);
    setFile(f ?? null);
    if (!f) return;
    setName(
      (n) =>
        n ||
        f.name
          .replace(/\.[^.]+$/, '')
          .replace(/[_-]+/g, ' ')
          .trim(),
    );
    setState('reading');
    try {
      const parsed = await parseGlb(await f.arrayBuffer());
      const raw = measureModel(parsed);
      const k = guessUnitFactor(raw);
      setRoot(parsed);
      setSize({ w: r3(raw.w * k), d: r3(raw.d * k), h: r3(Math.max(raw.h * k, 0.02)) });
      setRatio({ w: raw.w / Math.max(raw.h, 1e-6), d: raw.d / Math.max(raw.h, 1e-6) });
    } catch (e) {
      setError(e instanceof Error ? e.message : t('custom.readFailed'));
    } finally {
      setState('idle');
    }
  };

  const edit = (key: 'w' | 'd' | 'h', value: number) => {
    if (!Number.isFinite(value) || value <= 0) return;
    if (!keep) return setSize((s) => ({ ...s, [key]: value }));
    const h = key === 'h' ? value : key === 'w' ? value / ratio.w : value / ratio.d;
    setSize({ h: r3(h), w: r3(h * ratio.w), d: r3(h * ratio.d) });
  };

  const preview = useMemo(
    () => (root ? renderThumbnail(previewEntry(root, size)) : null),
    [root, size],
  );

  const save = async () => {
    if (!file || !root) return;
    setState('saving');
    setError('');
    try {
      await add(file, {
        name: name.trim(),
        category,
        placement,
        w: size.w,
        d: size.d,
        h: size.h,
        mountHeight: placement === 'wall-mounted' ? mount : undefined,
      });
      toast(tf('custom.added', { name: name.trim() }));
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : t('custom.readFailed'));
      setState('idle');
    }
  };

  const num = (v: number, set: (n: number) => void, testid: string, caption: string) => (
    <label className="block">
      <span className="text-[10px] text-slate-500">{caption}</span>
      <input
        type="number"
        min={0.02}
        max={30}
        step={0.01}
        value={v}
        data-testid={testid}
        onChange={(e) => set(Number(e.target.value))}
        className={field}
      />
    </label>
  );

  return (
    <Modal open onClose={onClose} label={tt('custom.modelTitle')} className="max-w-lg bg-white">
      <div className="space-y-3 p-4 text-slate-800">
        <h2 className="font-semibold">{tt('custom.modelTitle')}</h2>
        <div>
          <span className={label}>{tt('custom.modelFile')}</span>
          <input
            type="file"
            accept=".glb,model/gltf-binary"
            data-testid="custom-model-file"
            data-autofocus
            aria-label={tt('custom.modelFile')}
            onChange={(e) => void choose(e.target.files?.[0])}
            className="mt-1 block w-full text-sm"
          />
          <p className="mt-1 text-xs text-slate-500">{tt('custom.modelFileHint')}</p>
        </div>
        {state === 'reading' && (
          <p role="status" className="text-sm text-slate-600">
            {tt('custom.reading')}
          </p>
        )}
        {error && (
          <p role="alert" className="rounded bg-red-50 p-2 text-sm text-red-700">
            {error}
          </p>
        )}
        {root && (
          <div className="grid gap-3 sm:grid-cols-[8rem_1fr]">
            <div className="text-center">
              {preview ? (
                <img
                  src={preview}
                  alt={tt('custom.preview')}
                  className="mx-auto h-28 w-28 object-contain"
                />
              ) : (
                <div className="mx-auto h-28 w-28 rounded bg-slate-100" />
              )}
              <p className="mt-1 text-[10px] text-slate-500">{tt('custom.preview')}</p>
            </div>
            <div className="space-y-2">
              <label className="block">
                <span className={label}>{tt('custom.name')}</span>
                <input
                  value={name}
                  maxLength={60}
                  data-testid="custom-model-name"
                  onChange={(e) => setName(e.target.value)}
                  className={field}
                />
              </label>
              <div className="grid grid-cols-2 gap-2">
                <label className="block">
                  <span className={label}>{tt('custom.category')}</span>
                  <select
                    value={category}
                    onChange={(e) => setCategory(e.target.value as CatalogCategory)}
                    className={field}
                  >
                    {SHOWN.map((c) => (
                      <option key={c} value={c}>
                        {tt(`cat.${c}` as TranslationKey)}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="block">
                  <span className={label}>{tt('custom.placement')}</span>
                  <select
                    value={placement}
                    onChange={(e) => setPlacement(e.target.value as 'floor' | 'wall-mounted')}
                    className={field}
                  >
                    <option value="floor">{tt('custom.placeFloor')}</option>
                    <option value="wall-mounted">{tt('custom.placeWall')}</option>
                  </select>
                </label>
              </div>
              {placement === 'wall-mounted' && (
                <label className="block">
                  <span className={label}>{tt('custom.mountHeight')}</span>
                  <input
                    type="number"
                    min={0}
                    max={5}
                    step={0.05}
                    value={mount}
                    onChange={(e) => setMount(Number(e.target.value))}
                    className={field}
                  />
                </label>
              )}
              <div>
                <span className={label}>{tt('custom.size')}</span>
                <div className="grid grid-cols-3 gap-2">
                  {num(size.w, (v) => edit('w', v), 'custom-model-w', tt('custom.width'))}
                  {num(size.d, (v) => edit('d', v), 'custom-model-d', tt('custom.depth'))}
                  {num(size.h, (v) => edit('h', v), 'custom-model-h', tt('custom.height'))}
                </div>
                <label className="mt-1 flex items-center gap-1 text-xs text-slate-600">
                  <input
                    type="checkbox"
                    checked={keep}
                    onChange={(e) => setKeep(e.target.checked)}
                  />
                  {tt('custom.keepRatio')}
                </label>
              </div>
            </div>
          </div>
        )}
        <div className="flex justify-end gap-2 pt-1">
          <button className={btn} onClick={onClose}>
            {tt('custom.cancel')}
          </button>
          <button
            className={primary}
            data-testid="custom-model-save"
            disabled={!root || !name.trim() || state !== 'idle'}
            onClick={() => void save()}
          >
            {state === 'saving' ? tt('custom.saving') : tt('custom.add')}
          </button>
        </div>
      </div>
    </Modal>
  );
}
