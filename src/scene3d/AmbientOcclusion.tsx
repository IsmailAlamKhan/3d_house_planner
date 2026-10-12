import { EffectComposer, SSAO } from '@react-three/postprocessing';

/** Screen-space ambient occlusion: soft contact shadows in corners and under furniture (High quality only). */
export default function AmbientOcclusion() {
  return (
    <EffectComposer multisampling={0} enableNormalPass>
      <SSAO
        samples={14}
        rings={5}
        radius={0.12}
        intensity={11}
        bias={0.03}
        luminanceInfluence={0.55}
        worldDistanceThreshold={40}
        worldDistanceFalloff={8}
        worldProximityThreshold={0.6}
        worldProximityFalloff={0.35}
      />
    </EffectComposer>
  );
}
