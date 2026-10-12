import { X } from 'lucide-react';
import type { ReactNode } from 'react';
import { useT } from '../i18n';
import { Modal } from './Modal';
import { useMediaQuery } from './useMediaQuery';

interface DrawerProps {
  side: 'left' | 'right';
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
}

/**
 * The sidebars on screens narrower than `lg`: a panel sliding in from its side, or — on a phone — a bottom sheet.
 * It is a real dialog (focus stays inside, Esc and the backdrop close it) and disappears when the screen is wide
 * enough for the docked sidebar.
 */
export function Drawer({ side, open, onClose, title, children }: DrawerProps) {
  const t = useT();
  const wide = useMediaQuery('(min-width: 1024px)');
  const phone = useMediaQuery('(max-width: 639px)');
  if (!open || wide) return null;
  return (
    <Modal open onClose={onClose} label={title} placement={phone ? 'bottom' : side}>
      <div className="relative min-h-0 flex-1 overflow-hidden">
        {phone && <div aria-hidden className="mx-auto mt-2 h-1 w-10 rounded-full bg-slate-300" />}
        <button
          aria-label={t('drawer.close')}
          title={t('drawer.close')}
          onClick={onClose}
          className="absolute right-2 top-2 z-10 rounded p-1.5 hover:bg-slate-100"
        >
          <X size={16} />
        </button>
        <div className={phone ? 'h-[70vh]' : 'h-full'}>{children}</div>
      </div>
    </Modal>
  );
}
