import {
  Bloom,
  EffectComposer,
  SMAA,
  SSAO,
  ToneMapping,
  Vignette,
} from '@react-three/postprocessing';
import { ToneMappingMode } from 'postprocessing';
import { useEffect, useRef } from 'react';
import type { EffectComposer as Composer } from 'postprocessing';
import { setComposer } from './fxBridge';

/**
 * Presentation post-processing: bloom on glowing lamps, soft ambient occlusion, ACES tone mapping, a slight vignette
 * and SMAA anti-aliasing.
 */
export default function PresentationFx() {
  const ref = useRef<Composer>(null);
  useEffect(() => {
    setComposer(ref.current);
    return () => setComposer(null);
  });
  return (
    <EffectComposer ref={ref} multisampling={0} enableNormalPass>
      <SSAO
        samples={14}
        rings={5}
        radius={0.12}
        intensity={9}
        bias={0.03}
        luminanceInfluence={0.55}
        worldDistanceThreshold={40}
        worldDistanceFalloff={8}
        worldProximityThreshold={0.6}
        worldProximityFalloff={0.35}
      />
      <Bloom mipmapBlur intensity={0.9} luminanceThreshold={0.85} luminanceSmoothing={0.3} />
      <ToneMapping mode={ToneMappingMode.ACES_FILMIC} />
      <Vignette offset={0.3} darkness={0.55} />
      <SMAA />
    </EffectComposer>
  );
}
