import { type ReactNode, useEffect, useRef } from 'react';
import { useT } from '../i18n';

const FOCUSABLE =
  'a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])';

interface ModalProps {
  open: boolean;
  onClose: () => void;
  /** Accessible name of the dialog. */
  label: string;
  children: ReactNode;
  /** Classes of the panel (width, etc.). */
  className?: string;
  /**
   * Where the panel sits: `center`; `sheet` = centred, but pinned to the bottom edge on phones; `left` / `right` =
   * a full-height side panel; `bottom` = a bottom sheet.
   */
  placement?: 'center' | 'sheet' | 'left' | 'right' | 'bottom';
}

const WRAPPER: Record<NonNullable<ModalProps['placement']>, string> = {
  center: 'items-center justify-center p-4',
  sheet: 'items-end justify-center p-0 sm:items-center sm:p-4',
  left: 'items-stretch justify-start',
  right: 'items-stretch justify-end',
  bottom: 'items-end justify-center',
};
const PANEL: Record<NonNullable<ModalProps['placement']>, string> = {
  center: 'max-h-full w-full rounded-lg',
  sheet: 'max-h-[92vh] w-full rounded-t-2xl sm:max-h-full sm:rounded-lg anim-sheet sm:animate-none',
  left: 'h-full w-72 max-w-[85vw] anim-left',
  right: 'h-full w-72 max-w-[85vw] anim-right',
  bottom: 'max-h-[85vh] w-full rounded-t-2xl anim-sheet',
};

/**
 * Accessible modal: named, `aria-modal`, Esc closes, Tab stays inside, focus moves in on open and returns to where it
 * was on close, and the backdrop closes it on click.
 */
export function Modal({
  open,
  onClose,
  label,
  children,
  className = '',
  placement = 'center',
}: ModalProps) {
  const t = useT();
  const panel = useRef<HTMLDivElement>(null);
  const onCloseRef = useRef(onClose);
  useEffect(() => {
    onCloseRef.current = onClose;
  });

  useEffect(() => {
    if (!open) return;
    const before = document.activeElement as HTMLElement | null;
    const el = panel.current;
    const first =
      el?.querySelector<HTMLElement>('[data-autofocus]') ??
      el?.querySelector<HTMLElement>(FOCUSABLE) ??
      el;
    first?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        onCloseRef.current();
        return;
      }
      if (e.key !== 'Tab' || !el) return;
      const items = [...el.querySelectorAll<HTMLElement>(FOCUSABLE)].filter(
        (n) => n.offsetParent !== null,
      );
      if (!items.length) {
        e.preventDefault();
        return;
      }
      const a = items[0]!;
      const z = items[items.length - 1]!;
      if (e.shiftKey && (document.activeElement === a || !el.contains(document.activeElement))) {
        e.preventDefault();
        z.focus();
      } else if (
        !e.shiftKey &&
        (document.activeElement === z || !el.contains(document.activeElement))
      ) {
        e.preventDefault();
        a.focus();
      }
    };
    document.addEventListener('keydown', onKey, true);
    return () => {
      document.removeEventListener('keydown', onKey, true);
      before?.focus?.();
    };
  }, [open]);

  if (!open) return null;
  return (
    <div className={`fixed inset-0 z-50 flex ${WRAPPER[placement]}`}>
      <div aria-hidden className="absolute inset-0 bg-black/40" onClick={onClose} />
      <div
        ref={panel}
        role="dialog"
        aria-modal="true"
        aria-label={label}
        tabIndex={-1}
        className={`relative flex flex-col bg-white text-slate-800 shadow-xl outline-none ${PANEL[placement]} ${className}`}
      >
        {children}
        <span className="sr-only">{t('dialog.escHint')}</span>
      </div>
    </div>
  );
}
