import { useState, type ReactNode } from 'react';
import { ModelError } from '../model/ops';
import { edit } from '../model/store';
import { usePlanStore } from '../plan2d/planStore';
import { t } from '../i18n';

export const label = (s: string) => s.charAt(0).toUpperCase() + s.slice(1).replace(/-/g, ' ');

/** The value shared by every item, or `undefined` when they differ. */
export function shared<T, V>(items: T[], pick: (t: T) => V): V | undefined {
  const first = pick(items[0]!);
  return items.every((i) => pick(i) === first) ? first : undefined;
}

export function Row({ name, children }: { name: string; children: ReactNode }) {
  return (
    <label className="flex items-center justify-between gap-2 py-1 text-sm">
      <span className="text-slate-600">{name}</span>
      {children}
    </label>
  );
}

export const inputCls =
  'w-32 rounded border border-slate-300 bg-white px-2 py-1 text-sm focus:border-sky-400 focus:outline-none';

export function SelectField({
  name,
  value,
  options,
  onChange,
  mixed,
}: {
  name: string;
  value: string | undefined;
  options: string[];
  onChange: (v: string) => void;
  mixed: string;
}) {
  return (
    <Row name={name}>
      <select className={inputCls} value={value ?? ''} onChange={(e) => onChange(e.target.value)}>
        {value === undefined && (
          <option value="" disabled>
            {mixed}
          </option>
        )}
        {options.map((o) => (
          <option key={o} value={o}>
            {label(o)}
          </option>
        ))}
      </select>
    </Row>
  );
}

/** Numeric/text field that commits on blur or Enter. `key` re-mounts it when the stored value changes. */
export function CommitField({
  name,
  value,
  placeholder,
  onCommit,
  suffix,
}: {
  name: string;
  value: string;
  placeholder?: string;
  onCommit: (v: string) => void;
  suffix?: string;
}) {
  return (
    <Row name={name}>
      <span className="flex items-center gap-1">
        <input
          key={value}
          className={inputCls}
          defaultValue={value}
          placeholder={placeholder}
          onBlur={(e) => e.currentTarget.value !== value && onCommit(e.currentTarget.value)}
          onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
        />
        {suffix && <span className="text-xs text-slate-500">{suffix}</span>}
      </span>
    </Row>
  );
}

export function useEditor() {
  const setToast = usePlanStore((s) => s.setToast);
  const [error, setError] = useState<string | null>(null);
  const run = (fn: Parameters<typeof edit>[0]) => {
    try {
      edit(fn);
      setError(null);
    } catch (e) {
      const msg = e instanceof ModelError ? e.message : t('err.applyFailed');
      setError(msg);
      setToast(null);
    }
  };
  return { run, error };
}
