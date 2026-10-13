import { UnderlayDecals } from '../underlay/Decal3D';
import { type ThreeEvent } from '@react-three/fiber';
import { useEffect, useMemo, useState } from 'react';
import { EdgesGeometry, Plane, Vector3 } from 'three';
import { useCustomAssets } from '../custom/store';
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
import { useCamera } from './camera/cameraStore';
import { useSceneProject, useSceneReadOnly } from './sceneProject';
import { useExportFlags } from '../export/flags';
import { roomFocus } from './camera/isolation';
import { lampOn } from './lights';
import { getEntry } from '../catalog';
import { DoubleSide, MeshBasicMaterial } from 'three';

/** Builds (and memoizes) the renderable model for the current project and view options. */
export function useSceneModel(): LevelScene[] & { site: AnyPart[] } {
  const project = useSceneProject();
  const wallModePref = useSceneStore((s) => s.wallMode);
  const walking = useCamera((s) => s.mode === 'walk');
  const wallMode = walking ? 'up' : wallModePref;
  const doorsOpen = useSceneStore((s) => s.doorsOpen);
  // A fresh builder whenever the user's own models change: items using a model that was not known yet must be rebuilt.
  const customVersion = useCustomAssets((s) => s.version);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const builder = useMemo(() => new SceneBuilder(), [customVersion]);
  useEffect(() => () => builder.dispose(), [builder]);
  return useMemo(
    () => builder.build(project, { wallMode, cutHeight: DEFAULT_CUT_HEIGHT, doorsOpen }),
    [builder, project, wallMode, doorsOpen],
  );
}

/** Switches one fixture on or off (saved with the project, not an undo step). */
export function toggleLamp(itemId: string, currentlyOn: boolean): void {
  useModel.getState().setLights((l) => {
    l.items[itemId] = !currentlyOn;
  });
}

/** Invisible but still blocks light: ceilings, upper slabs and roofs hidden from the camera keep casting shadows. */
const SHADOW_ONLY = new MeshBasicMaterial({
  colorWrite: false,
  depthWrite: false,
  side: DoubleSide,
});

function ShadowOnlyMesh({ part }: { part: Part }) {
  return <mesh geometry={part.geometry} material={SHADOW_ONLY} castShadow raycast={() => null} />;
}

/** While measuring, a click picks a point on the surface instead of selecting. Returns true when it was used. */
function measureClick(e: ThreeEvent<MouseEvent>): boolean {
  const cam = useCamera.getState();
  if (cam.mode === 'walk') return true; // walking: clicks are for looking around
  if (!cam.measuring) return false;
  e.stopPropagation();
  cam.addMeasurePoint([e.point.x, e.point.y, e.point.z]);
  return true;
}

/** Double-click selects the thing and brings it into view. */
function focusOnDoubleClick(entity: NonNullable<Part['entity']>) {
  return (e: ThreeEvent<MouseEvent>) => {
    if (useCamera.getState().mode === 'walk' || useCamera.getState().measuring) return;
    e.stopPropagation();
    selectFrom3d(entity, false);
    useCamera.getState().requestFocus();
  };
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
      ghost,
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
  const readOnly = useSceneReadOnly();
  const onClick = (e: ThreeEvent<MouseEvent>) => {
    if (readOnly) return;
    if (useCatalogDrag.getState().armedId) return; // a library item is waiting to be placed here
    if (measureClick(e)) return;
    if (!part.entity) return;
    e.stopPropagation();
    if (useModel.getState().tool === 'eyedropper')
      return paintFrom3d(part, e.face?.materialIndex, e.nativeEvent.altKey);
    selectFrom3d(part.entity, e.nativeEvent.shiftKey);
  };
  const onDoubleClick = part.entity && !readOnly ? focusOnDoubleClick(part.entity) : undefined;
  return (
    <>
      <mesh
        geometry={part.geometry}
        material={materials}
        castShadow={!translucent && part.layer !== 'floor'}
        receiveShadow={!translucent}
        onClick={onClick}
        onDoubleClick={onDoubleClick}
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
  ghost,
  outdoor,
}: {
  part: ObjectPart;
  ghost: boolean;
  clip: Plane | undefined;
  selected: boolean;
  /** Show the move / rotate handle (a single selected piece of furniture). */
  gizmo: boolean;
  /** This light fixture is switched on: its lamp surfaces glow. */
  lit: boolean;
  outdoor: boolean;
}) {
  const mode = useSceneStore((s) => s.gizmoMode);
  const readOnly = useSceneReadOnly();
  // Bumped after a handle drag so the object snaps back to whatever the model says.
  const [nonce, setNonce] = useState(0);
  const object = useMemo(() => {
    void nonce;
    return prepareObject(part.object, {
      highlight: selected,
      lit: lit && part.lamp,
      clip: part.clipToCut ? clip : undefined,
      ghost,
      outdoor,
    });
  }, [part, selected, clip, nonce, lit, ghost, outdoor]);
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
      onDoubleClick={part.entity && !readOnly ? focusOnDoubleClick(part.entity) : undefined}
      onClick={(e: ThreeEvent<MouseEvent>) => {
        if (readOnly) return;
        if (useCatalogDrag.getState().armedId) return; // a library item is waiting to be placed here
        if (measureClick(e)) return;
        e.stopPropagation();
        if (useModel.getState().tool === 'eyedropper')
          return paintFrom3d(part, undefined, e.nativeEvent.altKey);
        // Clicking the glowing part of a light fixture switches it on or off.
        if (e.object.userData.lamp === true && part.entity) {
          toggleLamp(part.entity.id, lit);
        }
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
  const project = useSceneProject();
  const overrides = project.materials;
  const activeLevelId = useModel((s) => s.activeLevelId);
  const selection = useModel((s) => s.selection);
  const { levelFilter, dollhouse: dollhousePref, wallMode, lighting } = useSceneStore();
  const mode = useCamera((s) => s.mode);
  const isolation = useCamera((s) => s.isolation);
  const xray = useCamera((s) => s.xray);
  // Which light fixtures are switched on (their own switch, room, master, preset).
  const lampStates = useMemo(() => {
    const m = new Map<string, boolean>();
    for (const i of project.items)
      if (getEntry(i.catalogId)?.lamp) m.set(i.id, lampOn(project, i, lighting));
    return m;
  }, [project, lighting]);
  const presentation = useExportFlags((s) => s.presentation);
  // Walking through the home: everything is shown, whatever the 3D view options say.
  const walking = mode === 'walk';
  const dollhouse = dollhousePref && !walking;

  const activeIndex = levels.find((l) => l.level.id === activeLevelId)?.level.index ?? Infinity;
  const selected = useMemo(
    () =>
      presentation
        ? new Set<string>()
        : new Set(selection.ids.map((id) => `${selection.type}:${id}`)),
    [selection, presentation],
  );
  const focus = useMemo(
    () => (isolation.kind === 'room' && !walking ? roomFocus(project, isolation.roomId) : null),
    [isolation, project, walking],
  );
  const clips = useMemo(() => {
    const m = new Map<string, Plane>();
    if (wallMode === 'cut' && !walking)
      for (const l of levels)
        m.set(l.level.id, new Plane(new Vector3(0, -1, 0), l.level.elevation + DEFAULT_CUT_HEIGHT));
    return m;
  }, [levels, wallMode, walking]);

  /** Faint rendering: transparent walls, x-ray (everything but furniture) and rooms other than the isolated one. */
  const ghostOf = (part: AnyPart, levelId: string): boolean => {
    if (walking) return false;
    if (focus) return !focus.isSolid(part, levelId);
    if (xray) return part.layer !== 'item' && !(part.entity?.type === 'item');
    return wallMode === 'transparent' && part.layer === 'wall';
  };

  return (
    <>
      <group>
        {levels.site.map((p) => (
          <PartMesh
            key={p.id}
            part={p as Part}
            overrides={overrides}
            ghost={false}
            clip={undefined}
            selected={!!p.entity && selected.has(`${p.entity.type}:${p.entity.id}`)}
          />
        ))}
      </group>
      <UnderlayDecals />
      {levels.map(({ level, parts }) => {
        const shown = (() => {
          if (!level.visible) return false;
          if (walking) return true;
          if (isolation.kind === 'level') return level.id === isolation.levelId;
          return levelFilter === 'all' || level.index <= activeIndex;
        })();
        const blocksLight = (p: AnyPart) =>
          p.layer === 'ceiling' || p.layer === 'roof' || p.layer === 'slab';
        return (
          <group key={level.id} position={[0, level.elevation, 0]}>
            {parts.map((p: AnyPart) => {
              if (!shown)
                return blocksLight(p) && !isObjectPart(p) ? (
                  <ShadowOnlyMesh key={p.id} part={p} />
                ) : null;
              if (dollhouse && (p.layer === 'ceiling' || p.layer === 'roof') && !isObjectPart(p))
                return <ShadowOnlyMesh key={p.id} part={p} />;
              return isObjectPart(p) ? (
                <ObjectView
                  key={p.id}
                  part={p}
                  clip={clips.get(level.id)}
                  lit={lampStates.get(p.entity?.id ?? '') ?? false}
                  outdoor={
                    p.entity?.type === 'item' &&
                    getEntry(project.items.find((i) => i.id === p.entity!.id)?.catalogId ?? '')
                      ?.category === 'outdoor'
                  }
                  ghost={ghostOf(p, level.id)}
                  selected={!!p.entity && selected.has(`${p.entity.type}:${p.entity.id}`)}
                  gizmo={
                    !!p.entity &&
                    p.entity.type === 'item' &&
                    selection.type === 'item' &&
                    selection.ids.length === 1 &&
                    selection.ids[0] === p.entity.id &&
                    !walking &&
                    !presentation
                  }
                />
              ) : (
                <PartMesh
                  key={p.id}
                  part={p}
                  overrides={overrides}
                  ghost={ghostOf(p, level.id)}
                  clip={clips.get(level.id)}
                  selected={!!p.entity && selected.has(`${p.entity.type}:${p.entity.id}`)}
                />
              );
            })}
          </group>
        );
      })}
    </>
  );
}
