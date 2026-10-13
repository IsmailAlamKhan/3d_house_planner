import { useEffect, useMemo, useState } from 'react';
import { toast } from '../catalog/actions';
import { t, tf, useT } from '../i18n';
import { Modal } from '../ui/Modal';
import { customTextureId } from './protocol';
import { useCustomAssets } from './store';

const field = 'w-full rounded-md border border-slate-300 px-2 py-1 text-sm';
const label = 'block text-xs font-medium text-slate-600';
const btn = 'rounded-md border border-slate-300 px-3 py-1.5 text-sm hover:bg-slate-50';
const primary =
  'rounded-md bg-sky-700 px-3 py-1.5 text-sm font-medium text-white hover:bg-sky-800 disabled:opacity-50';

/** Dialog: upload a picture to use as a floor, wall or surface texture and say how big one repeat is. */
export function UploadTextureDialog(props: {
  open: boolean;
  onClose: () => void;
  /** Called with the new material id (`tex:…`) so the caller can apply it right away. */
  onUploaded?: (materialId: string) => void;
}) {
  // Mounted only while open, so every opening starts with a clean form.
  return props.open ? (
    <UploadTextureBody onClose={props.onClose} onUploaded={props.onUploaded} />
  ) : null;
}

function UploadTextureBody({
  onClose,
  onUploaded,
}: {
  onClose: () => void;
  /** Called with the new material id (`tex:…`) so the caller can apply it right away. */
  onUploaded?: (materialId: string) => void;
}) {
  const tt = useT();
  const add = useCustomAssets((s) => s.add);
  const [file, setFile] = useState<File | null>(null);
  const [name, setName] = useState('');
  const [scale, setScale] = useState(1);
  const [state, setState] = useState<'idle' | 'saving'>('idle');
  const [error, setError] = useState('');

  // The preview picture lives only as long as the chosen file.
  const url = useMemo(() => (file ? URL.createObjectURL(file) : null), [file]);
  useEffect(
    () => () => {
      if (url) URL.revokeObjectURL(url);
    },
    [url],
  );

  const choose = (f: File | undefined) => {
    setError('');
    setFile(f ?? null);
    if (f)
      setName(
        (n) =>
          n ||
          f.name
            .replace(/\.[^.]+$/, '')
            .replace(/[_-]+/g, ' ')
            .trim(),
      );
  };

  const save = async () => {
    if (!file) return;
    setState('saving');
    setError('');
    try {
      const a = await add(file, { name: name.trim(), scale });
      toast(tf('custom.added', { name: name.trim() }));
      onUploaded?.(customTextureId(a.id));
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : t('custom.readFailed'));
      setState('idle');
    }
  };

  return (
    <Modal open onClose={onClose} label={tt('custom.textureTitle')} className="max-w-md bg-white">
      <div className="space-y-3 p-4 text-slate-800">
        <h2 className="font-semibold">{tt('custom.textureTitle')}</h2>
        <div>
          <span className={label}>{tt('custom.textureFile')}</span>
          <input
            type="file"
            accept="image/png,image/jpeg,image/webp"
            data-testid="custom-texture-file"
            data-autofocus
            aria-label={tt('custom.textureFile')}
            onChange={(e) => choose(e.target.files?.[0])}
            className="mt-1 block w-full text-sm"
          />
          <p className="mt-1 text-xs text-slate-500">{tt('custom.textureFileHint')}</p>
        </div>
        {error && (
          <p role="alert" className="rounded bg-red-50 p-2 text-sm text-red-700">
            {error}
          </p>
        )}
        {url && (
          <div className="grid gap-3 sm:grid-cols-[7rem_1fr]">
            {/* 2 × 2 repeats: a picture that does not tile shows its seams here. */}
            <div
              role="img"
              aria-label={tt('custom.textureFile')}
              className="h-28 w-28 rounded border border-slate-300"
              style={{
                backgroundImage: `url(${url})`,
                backgroundSize: '50% 50%',
                backgroundRepeat: 'repeat',
              }}
            />
            <div className="space-y-2">
              <label className="block">
                <span className={label}>{tt('custom.name')}</span>
                <input
                  value={name}
                  maxLength={60}
                  data-testid="custom-texture-name"
                  onChange={(e) => setName(e.target.value)}
                  className={field}
                />
              </label>
              <label className="block">
                <span className={label}>{tt('custom.textureSize')}</span>
                <input
                  type="number"
                  min={0.05}
                  max={20}
                  step={0.05}
                  value={scale}
                  data-testid="custom-texture-scale"
                  onChange={(e) =>
                    setScale(Math.min(20, Math.max(0.05, Number(e.target.value) || 1)))
                  }
                  className={field}
                />
              </label>
            </div>
          </div>
        )}
        <div className="flex justify-end gap-2 pt-1">
          <button className={btn} onClick={onClose}>
            {tt('custom.cancel')}
          </button>
          <button
            className={primary}
            data-testid="custom-texture-save"
            disabled={!file || !name.trim() || state === 'saving'}
            onClick={() => void save()}
          >
            {state === 'saving' ? tt('custom.saving') : tt('custom.add')}
          </button>
        </div>
      </div>
    </Modal>
  );
}
