import { X } from 'lucide-react';
import type { ReactNode } from 'react';
import { useT } from '../i18n';

interface DrawerProps {
  side: 'left' | 'right';
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
}

/** Slide-in panel used for sidebars on narrow screens (hidden at lg and up). */
export function Drawer({ side, open, onClose, title, children }: DrawerProps) {
  const t = useT();
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-40 lg:hidden" role="dialog" aria-label={title}>
      <button
        aria-label={t('drawer.close')}
        className="absolute inset-0 bg-slate-900/40"
        onClick={onClose}
      />
      <div
        className={`absolute top-0 h-full w-72 max-w-[85vw] bg-white shadow-xl ${
          side === 'left' ? 'left-0' : 'right-0'
        }`}
      >
        <button
          aria-label={t('drawer.close')}
          onClick={onClose}
          className="absolute right-2 top-2 z-10 rounded p-1 hover:bg-slate-100"
        >
          <X size={16} />
        </button>
        {children}
      </div>
    </div>
  );
}
