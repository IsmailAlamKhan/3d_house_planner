import { useEffect, useRef } from 'react';

/**
 * Colour input that reports once, when the picker closes (the native `change` event) — React's `onChange`
 * would fire on every drag inside the picker and flood the undo history.
 */
export function NativeColor({
  value,
  onCommit,
  className,
}: {
  value: string;
  onCommit: (hex: string) => void;
  className?: string;
}) {
  const ref = useRef<HTMLInputElement>(null);
  const commit = useRef(onCommit);
  useEffect(() => {
    commit.current = onCommit;
  });
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const onChange = () => commit.current(el.value);
    el.addEventListener('change', onChange);
    return () => el.removeEventListener('change', onChange);
  }, []);
  // `key` re-mounts the input when the stored value changes so it shows the new colour.
  return <input key={value} ref={ref} type="color" defaultValue={value} className={className} />;
}
