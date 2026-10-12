import { useRef } from 'react';
import { useT } from '../../i18n';
import { useModel } from '../../model/store';
import { useCamera } from './cameraStore';
import { joystick } from './WalkRig';

const PAD = 112;

function Joystick() {
  const t = useT();
  const knob = useRef<HTMLDivElement>(null);
  const origin = useRef<{ x: number; y: number } | null>(null);
  const set = (dx: number, dy: number) => {
    const r = PAD / 2 - 18;
    const len = Math.hypot(dx, dy);
    const k = len > r ? r / len : 1;
    joystick.x = (dx * k) / r;
    joystick.y = (dy * k) / r;
    if (knob.current) knob.current.style.transform = `translate(${dx * k}px, ${dy * k}px)`;
  };
  const end = () => {
    origin.current = null;
    set(0, 0);
  };
  return (
    <div
      role="application"
      aria-label={t('walk.joystick')}
      className="pointer-events-auto absolute bottom-3 left-3 touch-none rounded-full bg-slate-800/30"
      style={{ width: PAD, height: PAD }}
      onPointerDown={(e) => {
        const r = e.currentTarget.getBoundingClientRect();
        origin.current = { x: r.left + r.width / 2, y: r.top + r.height / 2 };
        e.currentTarget.setPointerCapture(e.pointerId);
        set(e.clientX - origin.current.x, e.clientY - origin.current.y);
      }}
      onPointerMove={(e) =>
        origin.current && set(e.clientX - origin.current.x, e.clientY - origin.current.y)
      }
      onPointerUp={end}
      onPointerCancel={end}
    >
      <div
        ref={knob}
        className="absolute left-1/2 top-1/2 -ml-[18px] -mt-[18px] h-9 w-9 rounded-full bg-white shadow"
      />
    </div>
  );
}

/** Instructions, the current level and an exit button while walking through the model. */
export function WalkHud() {
  const t = useT();
  const mode = useCamera((s) => s.mode);
  const walker = useCamera((s) => s.walker);
  const activeLevel = useModel((s) => s.project.levels.find((l) => l.id === s.activeLevelId));
  if (mode !== 'walk') return null;
  const coarse = typeof window !== 'undefined' && window.matchMedia?.('(pointer: coarse)').matches;
  return (
    <>
      <div
        data-testid="walk-hud"
        data-level={activeLevel?.index ?? ''}
        data-x={walker ? walker.x.toFixed(2) : ''}
        data-y={walker ? walker.y.toFixed(2) : ''}
        data-floor={walker ? walker.floor.toFixed(2) : ''}
        className="pointer-events-none absolute bottom-24 left-1/2 flex max-w-[90%] -translate-x-1/2 items-center gap-2 rounded-md bg-slate-800/85 px-3 py-1.5 text-xs text-white shadow"
      >
        <span>
          {t('walk.level')}: <b>{activeLevel?.name}</b>
        </span>
        <span className="hidden sm:inline">· {t('walk.hint')}</span>
        <button
          className="pointer-events-auto rounded bg-white/20 px-2 py-0.5 hover:bg-white/30"
          onClick={() => useCamera.getState().setMode('orbit')}
        >
          {t('walk.exit')}
        </button>
      </div>
      {coarse && <Joystick />}
    </>
  );
}
