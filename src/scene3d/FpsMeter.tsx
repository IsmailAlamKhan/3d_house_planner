import { useFrame } from '@react-three/fiber';
import { useRef } from 'react';
import { useSceneStore } from './sceneStore';

/** Counts rendered frames and publishes the rate about once a second (only mounted while the readout is on). */
export function FpsMeter() {
  const setFps = useSceneStore((s) => s.setFps);
  const acc = useRef({ frames: 0, time: 0 });
  useFrame((_, delta) => {
    const a = acc.current;
    a.frames += 1;
    a.time += delta;
    if (a.time >= 1) {
      setFps(Math.round(a.frames / a.time));
      a.frames = 0;
      a.time = 0;
    }
  });
  return null;
}
