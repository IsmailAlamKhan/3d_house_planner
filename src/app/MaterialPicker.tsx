import { ChevronDown, ChevronUp } from 'lucide-react';
import { type ReactNode, useMemo, useState } from 'react';
import { type TranslationKey, useT } from '../i18n';
import {
  type MaterialCategory,
  customPaint,
  getSwatchUrl,
  isCustomPaint,
  materialsForCategory,
  resolveDef,
} from '../materials';
import { materialName } from '../materials/eyedropper';
import { NativeColor } from './NativeColor';

/** Flat colour or a small rendering of the procedural texture. */
export function Swatch({
  id,
  size = 28,
  selected = false,
}: {
  id: string;
  size?: number;
  selected?: boolean;
}) {
  const def = resolveDef(id);
  const url = useMemo(() => getSwatchUrl(def), [def]);
  return (
    <span
      aria-hidden
      className={`inline-block shrink-0 rounded border ${selected ? 'border-sky-500 ring-2 ring-sky-300' : 'border-slate-300'}`}
      style={{
        width: size,
        height: size,
        backgroundColor: def.color,
        backgroundImage: url ? `url(${url})` : undefined,
        backgroundSize: 'cover',
      }}
    />
  );
}

interface PickerProps {
  /** Heading, e.g. "Inside finish". */
  label: string;
  /** Current material id; `undefined` = mixed selection; `null` = nothing chosen (default look). */
  value: string | null | undefined;
  categories: MaterialCategory[];
  onPick: (id: string) => void;
  /** Offer a "default" swatch that clears the choice. */
  onClear?: () => void;
  /** Offer a colour input for any paint colour. */
  customPaint?: boolean;
  /** Shortcut buttons shown under the swatches ("same for this room", …). */
  children?: ReactNode;
}

/** Collapsible swatch grid used for walls, floors, ceilings and furniture surfaces. */
export function MaterialPicker({
  label,
  value,
  categories,
  onPick,
  onClear,
  customPaint: allowCustom,
  children,
}: PickerProps) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const mixed = value === undefined;
  return (
    <div className="border-t border-slate-100 py-2 first:border-t-0">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        aria-label={`${label}: ${value ? materialName(value) : mixed ? t('props.mixed') : t('mat.default')}`}
        className="flex w-full items-center gap-2 text-left text-sm"
      >
        {value ? (
          <Swatch id={value} />
        ) : (
          <span className="inline-block h-7 w-7 shrink-0 rounded border border-dashed border-slate-300" />
        )}
        <span className="min-w-0 flex-1">
          <span className="block text-slate-600">{label}</span>
          <span className="block truncate text-xs text-slate-500">
            {value ? materialName(value) : mixed ? t('props.mixed') : t('mat.default')}
          </span>
        </span>
        <span className="flex items-center text-xs text-sky-700">
          {t('mat.change')}
          {open ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
        </span>
      </button>
      {open && (
        <div className="mt-2 space-y-2">
          {onClear && (
            <button
              type="button"
              onClick={onClear}
              className="rounded border border-slate-300 px-2 py-0.5 text-xs hover:bg-slate-50"
            >
              {t('mat.default')}
            </button>
          )}
          {categories.map((c) => (
            <div key={c}>
              {categories.length > 1 && (
                <div className="mb-1 text-xs font-medium text-slate-500">
                  {t(`mat.cat.${c}` as TranslationKey)}
                </div>
              )}
              <div className="grid grid-cols-6 gap-1">
                {materialsForCategory(c).map((m) => (
                  <button
                    key={m.id}
                    type="button"
                    title={t(m.nameKey as TranslationKey)}
                    aria-label={t(m.nameKey as TranslationKey)}
                    aria-pressed={value === m.id}
                    onClick={() => onPick(m.id)}
                    className="rounded p-0.5 hover:bg-slate-100"
                  >
                    <Swatch id={m.id} selected={value === m.id} />
                  </button>
                ))}
              </div>
            </div>
          ))}
          {allowCustom && (
            <label className="flex items-center justify-between text-xs text-slate-600">
              {t('mat.custom')}
              <NativeColor
                value={value && isCustomPaint(value) ? resolveDef(value).color : '#d9c9b0'}
                onCommit={(hex) => onPick(customPaint(hex))}
                className="h-7 w-24 cursor-pointer rounded border border-slate-300 bg-white p-0.5"
              />
            </label>
          )}
        </div>
      )}
      {children && <div className="mt-2 flex flex-wrap gap-1">{children}</div>}
    </div>
  );
}

/** Small text button used for the "apply to…" shortcuts. */
export function ShortcutButton({
  onClick,
  children,
  disabled,
}: {
  onClick: () => void;
  children: ReactNode;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="rounded border border-slate-300 px-2 py-0.5 text-xs text-slate-700 hover:bg-slate-50 disabled:opacity-40"
    >
      {children}
    </button>
  );
}
