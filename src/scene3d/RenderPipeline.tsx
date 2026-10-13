import {
  Bloom,
  EffectComposer,
  FXAA,
  N8AO,
  SMAA,
  ToneMapping,
  Vignette,
  wrapEffect,
} from '@react-three/postprocessing';
import { Effect, ToneMappingMode } from 'postprocessing';
import { useEffect, useRef } from 'react';
import type { EffectComposer as Composer } from 'postprocessing';
import { Uniform } from 'three';
import { setComposer } from '../present/fxBridge';
import { usePresent } from '../present/presentStore';
import { RenderInfoProbe } from '../debug/RenderDebugPanel';
import { debugRenderEnabled, useDebug } from '../debug/debugStore';
import { QUALITY, type Quality } from './quality';
import { useSceneStore } from './sceneStore';

/** Scales the linear image by 2^EV: the one exposure control, applied before tone mapping. */
class ExposureEffect extends Effect {
  constructor({ ev = 0 }: { ev?: number } = {}) {
    super(
      'ExposureEffect',
      /* glsl */ `
      uniform float exposure;
      void mainImage(const in vec4 inputColor, const in vec2 uv, out vec4 outputColor) {
        outputColor = vec4(inputColor.rgb * exposure, inputColor.a);
      }`,
      { uniforms: new Map([['exposure', new Uniform(Math.pow(2, ev))]]) },
    );
  }
  set ev(v: number) {
    this.uniforms.get('exposure')!.value = Math.pow(2, v);
  }
}
const Exposure = wrapEffect(ExposureEffect);

/**
 * The ONE render pipeline for every quality tier (same colour pipeline, different cost):
 *
 *   scene (linear, half-float) → ambient occlusion (world-space radius; tiers: none / half / full resolution)
 *   → bloom on emissive surfaces only → exposure → AgX tone mapping, exactly once → vignette (presentation) → AA.
 *
 * The renderer itself has tone mapping switched off (`<Canvas flat>`): three.js only tone-maps when drawing to the
 * screen, so tone mapping must live in this chain — and only here.
 */
export default function RenderPipeline({ quality }: { quality: Quality }) {
  const q = QUALITY[quality];
  const ev = useSceneStore((s) => s.exposure);
  const presenting = usePresent((s) => s.active && s.fx);
  const ref = useRef<Composer>(null);
  const dbg = debugRenderEnabled();
  const flags = useDebug((s) => s.flags);
  const off = (k: keyof typeof flags) => dbg && !flags[k];
  useEffect(() => {
    setComposer(ref.current);
    return () => setComposer(null);
  });
  const children = [
    q.ao !== 'none' && !off('ao') && (
      <N8AO
        key="ao"
        halfRes={q.ao === 'half'}
        aoRadius={0.5}
        distanceFalloff={1.2}
        intensity={5}
        quality={q.ao === 'half' ? 'medium' : 'high'}
        screenSpaceRadius={false}
      />
    ),
    q.bloom && !off('bloom') && (
      <Bloom
        key="bloom"
        mipmapBlur
        intensity={presenting ? 0.9 : 0.55}
        // Only surfaces brighter than a white page (lamps and bulbs) bloom; ordinary walls and floors never do.
        luminanceThreshold={presenting ? 0.85 : 1.1}
        luminanceSmoothing={0.25}
      />
    ),
    <Exposure key="ev" ev={ev} />,
    !off('toneMapping') && <ToneMapping key="tm" mode={ToneMappingMode.AGX} />,
    presenting && <Vignette key="vg" offset={0.3} darkness={0.5} />,
    q.aa === 'smaa' ? <SMAA key="aa" /> : <FXAA key="aa" />,
  ].filter(Boolean) as React.ReactElement[];
  const names = children.map((c) => String(c.key ?? '?'));
  return (
    <>
      <RenderInfoProbe pipeline={['scene', ...names]} />
      <EffectComposer ref={ref} multisampling={0} depthBuffer>
        {children}
      </EffectComposer>
    </>
  );
}
