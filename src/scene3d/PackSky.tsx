import { useThree } from '@react-three/fiber';
import { useEffect } from 'react';
import {
  EquirectangularReflectionMapping,
  PMREMGenerator,
  type Scene,
  type WebGLRenderer,
} from 'three';
import { RGBELoader } from 'three/examples/jsm/loaders/RGBELoader.js';
import { create } from 'zustand';
import type { usePack as UsePack } from '../assets/pack';
import { useSceneStore } from './sceneStore';

/** True while the asset pack's HDRI sky is shown (the gradient dome steps aside). */
export const useSkyShown = create<{ shown: boolean }>(() => ({ shown: false }));

/** The sky file for the current look: night, dusk (evening / dusk) or a clear day; undefined without a usable pack. */
function skyFile(usePack: typeof UsePack): string | undefined {
  const pack = usePack.getState();
  if (!pack.enabled || pack.status !== 'ready') return undefined;
  const mode = useSceneStore.getState().lighting.mode;
  const preset =
    mode === 'night' ? 'night' : mode === 'evening' || mode === 'dusk' ? 'dusk' : 'day';
  return pack.index?.hdris.find((h) => h.preset === preset)?.file;
}

/**
 * The HDRI sky of the asset pack for the current look (a clear day, dusk, night): it becomes the background and the
 * image-based light and reflections. Nothing happens without the pack; interiors stay as dark as the lamps and the light
 * through the windows make them (the sky only lights what it reaches). It follows the pack and the look through store
 * subscriptions, not React state, so it never re-renders the scene.
 */
export function PackSky() {
  const get = useThree((s) => s.get);
  useEffect(() => {
    let stop: (() => void) | undefined;
    let gone = false;
    // the pack loader is fetched on demand, so the scene does not depend on it at start-up
    void import('../assets/pack').then(({ usePack }) => {
      if (!gone) stop = start(get, usePack);
    });
    return () => {
      gone = true;
      stop?.();
    };
  }, [get]);
  return null;
}

function start(
  get: () => { gl: WebGLRenderer; scene: Scene },
  usePack: typeof UsePack,
): () => void {
  {
    const { gl, scene } = get();
    let current: string | undefined;
    let release: (() => void) | undefined;
    const show = (file: string | undefined) => {
      if (file === current) return;
      release?.();
      release = undefined;
      current = file;
      if (!file) return;
      let cancelled = false;
      const before = scene.environment;
      const pmrem = new PMREMGenerator(gl);
      let target: { texture: unknown; dispose: () => void } | undefined;
      let sky: { dispose: () => void } | undefined;
      void new RGBELoader().loadAsync(`/pack/${file}`).then(
        (tex) => {
          if (cancelled) return tex.dispose();
          tex.mapping = EquirectangularReflectionMapping;
          const rt = pmrem.fromEquirectangular(tex);
          target = rt;
          scene.environment = rt.texture;
          scene.background = tex;
          scene.backgroundIntensity = 1;
          sky = tex;
          useSkyShown.setState({ shown: true });
        },
        () => undefined, // not loadable: the gradient sky and the room environment stay
      );
      release = () => {
        cancelled = true;
        if (sky) {
          scene.environment = before;
          scene.background = null;
          sky.dispose();
          target?.dispose();
          useSkyShown.setState({ shown: false });
        }
        pmrem.dispose();
      };
    };
    const update = () => show(skyFile(usePack));
    update();
    const unsubPack = usePack.subscribe(update);
    const unsubScene = useSceneStore.subscribe(update);
    return () => {
      unsubPack();
      unsubScene();
      show(undefined);
    };
  }
}
