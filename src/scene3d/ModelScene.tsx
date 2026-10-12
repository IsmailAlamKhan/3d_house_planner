import { type ThreeEvent } from '@react-three/fiber';
import { useEffect, useMemo, useState } from 'react';
import { EdgesGeometry, Plane, Vector3 } from 'three';
import { useModel } from '../model/store';
import type { MaterialOverride } from '../model/types';
import type { Part } from './generators/common';
import { getMaterial } from './materials3d';
import { selectFrom3d } from './select';
import { DEFAULT_CUT_HEIGHT, type LevelScene, SceneBuilder } from './sceneModel';
import { useSceneStore } from './sceneStore';

/** Builds (and memoizes) the renderable model for the current project and view options. */
export function useSceneModel(): LevelScene[] {
  const project = useModel((s) => s.project);
  const wallMode = useSceneStore((s) => s.wallMode);
  const doorsOpen = useSceneStore((s) => s.doorsOpen);
  const [builder] = useState(() => new SceneBuilder());
  useEffect(() => () => builder.dispose(), [builder]);
  return useMemo(
    () => builder.build(project, { wallMode, cutHeight: DEFAULT_CUT_HEIGHT, doorsOpen }),
    [builder, project, wallMode, doorsOpen],
  );
}

interface PartMeshProps {
  part: Part;
  overrides: Record<string, MaterialOverride>;
  ghost: boolean;
  clip: Plane | undefined;
  selected: boolean;
}

function PartMesh({ part, overrides, ghost, clip, selected }: PartMeshProps) {
  const materials = useMemo(() => {
    const flags = {
      ghost: ghost && part.layer === 'wall',
      clip: part.clipToCut ? clip : undefined,
      highlight: selected,
    };
    const list = part.materials.map((k) => getMaterial(k, overrides, flags));
    return list.length === 1 ? list[0]! : list;
  }, [part, overrides, ghost, clip, selected]);
  const edges = useMemo(
    () => (selected ? new EdgesGeometry(part.geometry, 25) : null),
    [selected, part.geometry],
  );
  useEffect(() => () => edges?.dispose(), [edges]);
  const translucent = part.materials.includes('glass');
  const onClick = part.entity
    ? (e: ThreeEvent<MouseEvent>) => {
        e.stopPropagation();
        selectFrom3d(part.entity, e.nativeEvent.shiftKey);
      }
    : undefined;
  return (
    <>
      <mesh
        geometry={part.geometry}
        material={materials}
        castShadow={!translucent && part.layer !== 'floor'}
        receiveShadow={!translucent}
        onClick={onClick}
      />
      {edges && (
        <lineSegments geometry={edges} renderOrder={10}>
          <lineBasicMaterial color="#0284c7" depthTest={false} transparent />
        </lineSegments>
      )}
    </>
  );
}

/** All levels of the apartment, stacked at their elevations. */
export function ModelScene() {
  const levels = useSceneModel();
  const overrides = useModel((s) => s.project.materials);
  const activeLevelId = useModel((s) => s.activeLevelId);
  const selection = useModel((s) => s.selection);
  const { levelFilter, dollhouse, wallMode } = useSceneStore();

  const activeIndex = levels.find((l) => l.level.id === activeLevelId)?.level.index ?? Infinity;
  const selected = useMemo(
    () => new Set(selection.ids.map((id) => `${selection.type}:${id}`)),
    [selection],
  );
  const clips = useMemo(() => {
    const m = new Map<string, Plane>();
    if (wallMode === 'cut')
      for (const l of levels)
        m.set(l.level.id, new Plane(new Vector3(0, -1, 0), l.level.elevation + DEFAULT_CUT_HEIGHT));
    return m;
  }, [levels, wallMode]);

  return (
    <>
      {levels
        .filter(
          ({ level }) => level.visible && (levelFilter === 'all' || level.index <= activeIndex),
        )
        .map(({ level, parts }) => (
          <group key={level.id} position={[0, level.elevation, 0]}>
            {parts
              .filter((p) => !(dollhouse && (p.layer === 'ceiling' || p.layer === 'roof')))
              .map((p) => (
                <PartMesh
                  key={p.id}
                  part={p}
                  overrides={overrides}
                  ghost={wallMode === 'transparent'}
                  clip={clips.get(level.id)}
                  selected={!!p.entity && selected.has(`${p.entity.type}:${p.entity.id}`)}
                />
              ))}
          </group>
        ))}
    </>
  );
}
