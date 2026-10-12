import { Html, Line } from '@react-three/drei';
import { useModel } from '../../model/store';
import { useCamera } from './cameraStore';
import { measurementLabel, midpoint3 } from './measure';
import type { Vec3 } from './views';

const Dot = ({ at }: { at: Vec3 }) => (
  <mesh position={at} renderOrder={20}>
    <sphereGeometry args={[0.04, 12, 12]} />
    <meshBasicMaterial color="#f97316" depthTest={false} transparent />
  </mesh>
);

/** Dimension lines (with labels) for the distances picked in the 3D view. */
export function MeasureOverlay() {
  const measurements = useCamera((s) => s.measurements);
  const pending = useCamera((s) => s.pending);
  const units = useModel((s) => s.project.units);
  return (
    <>
      {measurements.map((m, i) => (
        <group key={i} name="measurement">
          <Line
            points={[m.a, m.b]}
            color="#f97316"
            lineWidth={2}
            depthTest={false}
            renderOrder={20}
          />
          <Dot at={m.a} />
          <Dot at={m.b} />
          <Html
            position={midpoint3(m.a, m.b)}
            center
            zIndexRange={[20, 0]}
            style={{ pointerEvents: 'none' }}
          >
            <div
              data-testid="measure-label"
              className="whitespace-nowrap rounded bg-orange-500 px-1.5 py-0.5 text-xs font-medium text-white shadow"
            >
              {measurementLabel(m, units)}
            </div>
          </Html>
        </group>
      ))}
      {pending && <Dot at={pending} />}
    </>
  );
}
