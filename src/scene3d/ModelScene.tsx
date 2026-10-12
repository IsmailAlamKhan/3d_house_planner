import { type ThreeEvent } from '@react-three/fiber';
import { useEffect, useMemo, useState } from 'react';
import { EdgesGeometry, Plane, Vector3 } from 'three';
import { t } from '../i18n';
import { useModel } from '../model/store';
import type { MaterialOverride } from '../model/types';
import { type AnyPart, type ObjectPart, type Part, isObjectPart } from './generators/common';
import { prepareObject } from './objectView';
import { getMaterial } from './materials3d';
import { TransformControls } from '@react-three/drei';
import { moveItemTo } from '../catalog/actions';
import { useCatalogDrag } from '../catalog/dragStore';
import { selectFrom3d } from './select';
import { eyedrop } from '../materials/eyedropper';
import { toast } from '../catalog/actions';
import { surfaceFromPart } from './eyedropper3d';
import { DEFAULT_CUT_HEIGHT, type LevelScene, SceneBuilder } from './sceneModel';
import { useSceneStore } from './sceneStore';
import { interiorLightsOn } from './lighting';

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
        if (useCatalogDrag.getState().armedId) return; // a library item is waiting to be placed here
        e.stopPropagation();
        if (useModel.getState().tool === 'eyedropper')
          return paintFrom3d(part, e.face?.materialIndex, e.nativeEvent.altKey);
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
        userData={{ entity: part.entity }}
      />
      {edges && (
        <lineSegments geometry={edges} renderOrder={10}>
          <lineBasicMaterial color="#0284c7" depthTest={false} transparent />
        </lineSegments>
      )}
    </>
  );
}

/** Eyedropper click in the 3D view: copy the surface's material, or paint the held one onto it. */
function paintFrom3d(part: AnyPart, materialIndex: number | undefined, alt: boolean): void {
  const surface = surfaceFromPart(useModel.getState().project, part, materialIndex);
  if (surface) eyedrop(surface, alt);
  else toast(t('mat.noSurface'));
}

function ObjectView({
  part,
  clip,
  selected,
  gizmo,
  lit,
}: {
  part: ObjectPart;
  clip: Plane | undefined;
  selected: boolean;
  /** Show the move / rotate handle (a single selected piece of furniture). */
  gizmo: boolean;
  /** Interior lights are on: lamp surfaces glow. */
  lit: boolean;
}) {
  const mode = useSceneStore((s) => s.gizmoMode);
  // Bumped after a handle drag so the object snaps back to whatever the model says.
  const [nonce, setNonce] = useState(0);
  const object = useMemo(() => {
    void nonce;
    return prepareObject(part.object, {
      highlight: selected,
      lit: lit && part.lamp,
      clip: part.clipToCut ? clip : undefined,
    });
  }, [part, selected, clip, nonce, lit]);
  const commit = () => {
    const id = part.entity?.id;
    if (id) {
      const rotation = ((-object.rotation.y % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2);
      moveItemTo(
        id,
        { x: object.position.x, y: object.position.z },
        { rotation, snapWalls: mode === 'translate' },
      );
    }
    setNonce((n) => n + 1);
  };
  return (
    <group
      userData={{ entity: part.entity }}
      onClick={(e: ThreeEvent<MouseEvent>) => {
        if (useCatalogDrag.getState().armedId) return; // a library item is waiting to be placed here
        e.stopPropagation();
        if (useModel.getState().tool === 'eyedropper')
          return paintFrom3d(part, undefined, e.nativeEvent.altKey);
        selectFrom3d(part.entity, e.nativeEvent.shiftKey);
      }}
    >
      <primitive object={object} />
      {gizmo && (
        <TransformControls
          object={object}
          mode={mode}
          showX={mode === 'translate'}
          showY={mode === 'rotate'}
          showZ={mode === 'translate'}
          translationSnap={0.05}
          rotationSnap={Math.PI / 12}
          onMouseUp={commit}
        />
      )}
    </group>
  );
}

/** All levels of the apartment, stacked at their elevations. */
export function ModelScene() {
  const levels = useSceneModel();
  const overrides = useModel((s) => s.project.materials);
  const activeLevelId = useModel((s) => s.activeLevelId);
  const selection = useModel((s) => s.selection);
  const { levelFilter, dollhouse, wallMode, lighting } = useSceneStore();
  const lightsOn = interiorLightsOn(lighting);

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
              .map((p: AnyPart) =>
                isObjectPart(p) ? (
                  <ObjectView
                    key={p.id}
                    part={p}
                    clip={clips.get(level.id)}
                    lit={lightsOn}
                    selected={!!p.entity && selected.has(`${p.entity.type}:${p.entity.id}`)}
                    gizmo={
                      !!p.entity &&
                      p.entity.type === 'item' &&
                      selection.type === 'item' &&
                      selection.ids.length === 1 &&
                      selection.ids[0] === p.entity.id
                    }
                  />
                ) : (
                  <PartMesh
                    key={p.id}
                    part={p}
                    overrides={overrides}
                    ghost={wallMode === 'transparent'}
                    clip={clips.get(level.id)}
                    selected={!!p.entity && selected.has(`${p.entity.type}:${p.entity.id}`)}
                  />
                ),
              )}
          </group>
        ))}
    </>
  );
}
