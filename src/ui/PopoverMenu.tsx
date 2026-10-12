import { type ReactNode, useEffect, useRef, useState } from 'react';

/** A button that opens a small panel under it; Esc or a click outside closes it, and focus returns to the button. */
export function PopoverMenu({
  label,
  icon,
  children,
  className = '',
  align = 'right',
  tourId,
  showLabel = false,
}: {
  label: string;
  icon: ReactNode;
  children: (close: () => void) => ReactNode;
  className?: string;
  align?: 'left' | 'right';
  tourId?: string;
  showLabel?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!root.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setOpen(false);
        button.current?.focus();
      }
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);
  return (
    <div ref={root} className="relative">
      <button
        ref={button}
        title={label}
        aria-label={label}
        aria-haspopup="true"
        aria-expanded={open}
        data-tour={tourId}
        onClick={() => setOpen(!open)}
        className={`inline-flex items-center gap-1 rounded-md px-2 py-1.5 text-sm hover:bg-slate-100 ${className}`}
      >
        {icon}
        {showLabel && <span className="hidden md:inline">{label}</span>}
      </button>
      {open && (
        <div
          role="menu"
          aria-label={label}
          className={`anim-panel absolute top-full z-30 mt-1 min-w-56 rounded-lg border border-slate-200 bg-white p-2 text-sm text-slate-800 shadow-lg ${align === 'right' ? 'right-0' : 'left-0'}`}
        >
          {children(() => setOpen(false))}
        </div>
      )}
    </div>
  );
}
