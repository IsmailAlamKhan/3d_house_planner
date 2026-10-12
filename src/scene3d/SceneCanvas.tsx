import { Canvas } from '@react-three/fiber';
import { Grid, OrbitControls } from '@react-three/drei';

/** 3D viewport. Placeholder scene (grid, lights, test box); generated from the model later. */
export function SceneCanvas() {
  return (
    <div data-testid="scene-canvas" className="h-full w-full bg-slate-200">
      <Canvas camera={{ position: [6, 5, 8], fov: 50 }} shadows>
        <ambientLight intensity={0.6} />
        <directionalLight position={[5, 8, 5]} intensity={1.1} castShadow />
        <Grid
          args={[40, 40]}
          cellSize={1}
          sectionSize={5}
          cellColor="#94a3b8"
          sectionColor="#64748b"
          fadeDistance={40}
          infiniteGrid
        />
        <mesh position={[0, 0.5, 0]} castShadow>
          <boxGeometry args={[1, 1, 1]} />
          <meshStandardMaterial color="#f59e0b" />
        </mesh>
        <OrbitControls makeDefault />
      </Canvas>
    </div>
  );
}
