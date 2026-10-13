import { useFrame, useThree } from '@react-three/fiber';
import { useEffect } from 'react';
import { Matrix4 } from 'three';
import { setLabelFrame } from './labelFrame';

const m = new Matrix4();

/** Inside the Canvas: publishes the camera matrices so labels can be drawn over the picture. */
export function LabelsProjector() {
  const size = useThree((s) => s.size);
  useFrame(({ camera }) => {
    camera.updateMatrixWorld();
    m.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
    setLabelFrame({ viewProjection: m.toArray(), width: size.width, height: size.height });
  });
  useEffect(() => () => setLabelFrame(null), []);
  return null;
}
