import { useThree } from '@react-three/fiber';
import { useEffect } from 'react';
import {
  ACESFilmicToneMapping,
  AgXToneMapping,
  LinearToneMapping,
  NoToneMapping,
  PCFShadowMap,
  PCFSoftShadowMap,
  ReinhardToneMapping,
  SRGBColorSpace,
  VSMShadowMap,
} from 'three';
import { DEBUG_DEFAULTS, type DebugFlags, debugRenderEnabled, useDebug } from './debugStore';
import { useSceneStore } from '../scene3d/sceneStore';

const TONE: Record<number, string> = {
  [NoToneMapping]: 'none (the pipeline tone-maps)',
  [LinearToneMapping]: 'linear',
  [ReinhardToneMapping]: 'Reinhard',
  [ACESFilmicToneMapping]: 'ACES',
  [AgXToneMapping]: 'AgX',
};
const SHADOW: Record<number, string> = {
  [PCFShadowMap]: 'PCF',
  [PCFSoftShadowMap]: 'PCF soft',
  [VSMShadowMap]: 'VSM',
};

/** Inside the Canvas: publishes what the renderer is doing so the panel can show it. */
export function RenderInfoProbe({ pipeline }: { pipeline: string[] }) {
  const get = useThree((s) => s.get);
  const gl = useThree((s) => s.gl);
  const exposure = useSceneStore((s) => s.exposure);
  const flags = useDebug((s) => s.flags);
  useEffect(() => {
    if (!debugRenderEnabled()) return;
    useDebug.getState().setInfo({
      outputColorSpace:
        gl.outputColorSpace === SRGBColorSpace ? 'sRGB' : String(gl.outputColorSpace),
      toneMapping: TONE[gl.toneMapping] ?? String(gl.toneMapping),
      exposure: Math.pow(2, exposure),
      pixelRatio: gl.getPixelRatio(),
      shadowMapType: gl.shadowMap.enabled
        ? (SHADOW[gl.shadowMap.type] ?? String(gl.shadowMap.type))
        : 'off',
      pipeline,
    });
  }, [gl, exposure, pipeline, flags]);
  // The shadow switch acts on the renderer itself.
  useEffect(() => {
    if (!debugRenderEnabled()) return;
    get().gl.shadowMap.enabled = flags.shadows;
  }, [get, flags.shadows]);
  return null;
}

const LABELS: [keyof DebugFlags, string][] = [
  ['shadows', 'Shadows'],
  ['ao', 'Ambient occlusion'],
  ['bloom', 'Bloom'],
  ['toneMapping', 'Tone mapping'],
  ['environment', 'Environment light'],
  ['hemisphere', 'Sky (hemisphere) light'],
  ['sun', 'Sun / moon'],
  ['interiorLights', 'Lamps (point / spot)'],
  ['windowLights', 'Window area lights'],
  ['skyMask', 'Keep sky out of interiors'],
];

/** `?debug=render`: switch each effect and light type on and off, and read the renderer's colour settings. */
export function RenderDebugPanel() {
  const { flags, info, set } = useDebug();
  if (!debugRenderEnabled()) return null;
  return (
    <div
      data-testid="render-debug"
      className="absolute bottom-2 left-2 z-30 w-60 space-y-1 rounded-lg border border-slate-300 bg-white/95 p-2 text-[11px] shadow"
    >
      <p className="font-semibold">Render debug</p>
      {LABELS.map(([k, label]) => (
        <label key={k} className="flex items-center gap-1">
          <input
            type="checkbox"
            checked={flags[k]}
            onChange={(e) => set({ [k]: e.target.checked })}
          />
          {label}
        </label>
      ))}
      <button className="rounded bg-slate-100 px-2 py-0.5" onClick={() => set(DEBUG_DEFAULTS)}>
        Reset
      </button>
      {info && (
        <dl
          data-testid="render-debug-info"
          className="space-y-0.5 border-t border-slate-200 pt-1 text-slate-600"
        >
          <div>Colour space: {info.outputColorSpace}</div>
          <div>Renderer tone mapping: {info.toneMapping}</div>
          <div>Exposure: ×{info.exposure.toFixed(2)}</div>
          <div>Pixel ratio: {info.pixelRatio}</div>
          <div>Shadows: {info.shadowMapType}</div>
          <div>Chain: {info.pipeline.join(' → ')}</div>
        </dl>
      )}
    </div>
  );
}
