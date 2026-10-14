import { Matrix4, OrthographicCamera, PerspectiveCamera, Vector3 } from 'three';
import { polygonBounds } from '../geometry/polygon';
import { describeCamera } from '../export/bridge';
import { exportGlb } from '../export/model3d';
import { useModel } from '../model/store';
import type { Project } from '../model/types';
import { visibleLevelIds } from '../present/LabelsOverlay';
import { usePresent } from '../present/presentStore';
import { DEFAULT_CUT_HEIGHT } from '../scene3d/sceneModel';
import { moonAt, sunAt, sunVisible, timeOf, type LightingState } from '../scene3d/lighting';
import { useSceneStore } from '../scene3d/sceneStore';
import { studioLamps, studioWindows } from './lamps';
import {
  QUALITY_PRESETS,
  type StudioQuality,
  type StudioSidecar,
  StudioSidecarSchema,
} from './protocol';

export interface StudioBundle {
  glb: ArrayBuffer;
  sidecar: StudioSidecar;
}

export interface StudioBundleOptions {
  quality: StudioQuality;
  /** Look name for the file name and gallery. */
  look?: string;
  /** Take the camera from a saved view instead of the live one (a top view stays orthographic). */
  view?: Project['views'][number];
  /** Soft glow around bright lights. */
  glare?: boolean;
  /** Extra soft accent lights (as in presentation mode). */
  accent?: boolean;
  /** Extra exposure in stops on top of the 3D view's. */
  exposure?: number;
  /** Colour temperature of every interior lamp (default: each lamp's own). */
  kelvin?: number;
}

/** Sky, sun and exposure for a lighting look. Dusk and night are lit by the sky itself, so they get no sun lamp. */
export function environmentFor(
  lighting: LightingState,
  compass: number,
  exposure: number,
): StudioSidecar['environment'] {
  const night = lighting.mode === 'night';
  const dusk = ['dusk', 'evening', 'marketing'].includes(lighting.mode);
  const sun = sunVisible(lighting) ? sunAt(timeOf(lighting), compass) : moonAt(compass);
  return {
    hdri: night ? 'night' : dusk ? 'dusk' : 'day',
    hdriStrength: night ? 0.8 : 1,
    sun: {
      direction: sun.direction,
      color: sun.color,
      strength: night || dusk ? 0 : Math.round(sun.intensity * 2.2 * 100) / 100,
    },
    exposure,
  };
}

/** Projection × view of a studio camera, as the browser's labels need it. */
function viewProjectionOf(cam: StudioSidecar['camera'], aspect: number): number[] {
  const c =
    cam.kind === 'ortho'
      ? new OrthographicCamera(
          (-cam.orthoHeight! * aspect) / 2,
          (cam.orthoHeight! * aspect) / 2,
          cam.orthoHeight! / 2,
          -cam.orthoHeight! / 2,
          cam.near,
          cam.far,
        )
      : new PerspectiveCamera(cam.fov, aspect, cam.near, cam.far);
  c.matrixWorld.fromArray(cam.matrixWorld);
  c.matrixWorldInverse.copy(c.matrixWorld).invert();
  c.updateProjectionMatrix();
  return new Matrix4().multiplyMatrices(c.projectionMatrix, c.matrixWorldInverse).toArray();
}

/** A camera looking from `position` at `target` (world, metres, y up). */
function lookAtMatrix(position: number[], target: number[], top: boolean): number[] {
  const eye = new Vector3(...(position as [number, number, number]));
  const to = new Vector3(...(target as [number, number, number]));
  const up = top ? new Vector3(0, 0, -1) : new Vector3(0, 1, 0);
  const m = new Matrix4().lookAt(eye, to, up);
  m.setPosition(eye);
  return m.toArray();
}

/** Width / height of the plot (or the building) with a margin, kept between 0.55 and 1.8. */
function plotAspect(project: Project): number {
  const outline = project.site.plot.length >= 3 ? project.site.plot : project.shell.footprint;
  const bb = polygonBounds(outline);
  const a = (bb.max.x - bb.min.x) / Math.max(bb.max.y - bb.min.y, 0.1);
  return Math.min(1.8, Math.max(0.55, a));
}

/** An orthographic camera straight above the whole plot (or the building), framing it with a margin. */
function topDownCamera(
  project: Project,
  aspect: number,
  live: { near: number; far: number },
): StudioSidecar['camera'] {
  const outline = project.site.plot.length >= 3 ? project.site.plot : project.shell.footprint;
  const bb = polygonBounds(outline);
  const w = bb.max.x - bb.min.x;
  const d = bb.max.y - bb.min.y;
  const cx = (bb.min.x + bb.max.x) / 2;
  const cz = (bb.min.y + bb.max.y) / 2;
  // the view must hold both the width (across the picture) and the depth (up the picture)
  const height = Math.max(d, w / aspect) * 1.06;
  return {
    matrixWorld: lookAtMatrix([cx, 80, cz], [cx, 0, cz], true),
    kind: 'ortho',
    fov: 45,
    orthoHeight: height,
    near: live.near,
    far: live.far,
  };
}

/**
 * The studio bundle for the design as the 3D view shows it now: the building as a glb with every material and per-mesh
 * metadata (layer, entity, material id), and the sidecar with the camera, the lights in physical units, the sky, the
 * cutaway and the output size.
 */
export async function buildStudioBundle(o: StudioBundleOptions): Promise<StudioBundle> {
  const project = useModel.getState().project;
  const scene = useSceneStore.getState();
  const present = usePresent.getState();
  const live = describeCamera();
  if (!live) throw new Error('The 3D view is not open.');

  const cutaway = scene.dollhouse || (present.active && present.preset !== 'eye');
  const wallMode = scene.wallMode === 'cut' ? 'cut' : 'up';
  const levels = visibleLevelIds(project);
  const glb = await exportGlb(project, {
    wallMode,
    cutHeight: DEFAULT_CUT_HEIGHT,
    visibleLevelIds: levels,
    meta: true,
  });

  const { longSide } = QUALITY_PRESETS[o.quality];
  const top = o.view?.mode === 'top';
  // a top view of the plot gets a picture shaped like the plot; other views keep the shape of the 3D view
  const aspect = top ? plotAspect(project) : live.aspect;
  const width = aspect >= 1 ? longSide : Math.round(longSide * aspect);
  const height = aspect >= 1 ? Math.round(longSide / aspect) : longSide;
  const camera: StudioSidecar['camera'] = o.view
    ? top
      ? topDownCamera(project, aspect, live)
      : {
          matrixWorld: lookAtMatrix(o.view.position, o.view.target, false),
          kind: 'perspective',
          fov: 45,
          near: live.near,
          far: live.far,
        }
    : {
        matrixWorld: live.matrixWorld,
        kind: live.kind,
        fov: live.fov,
        orthoHeight: live.orthoHeight,
        near: live.near,
        far: live.far,
      };

  const sidecar = StudioSidecarSchema.parse({
    version: 1,
    projectId: project.id,
    projectName: project.name,
    look: o.look ?? 'custom',
    output: { width, height },
    camera,
    environment: environmentFor(
      scene.lighting,
      project.settings.compass,
      scene.exposure + (o.exposure ?? 0),
    ),
    cutaway: { enabled: cutaway, cutHeight: wallMode === 'cut' ? DEFAULT_CUT_HEIGHT : undefined },
    lights: {
      lamps: studioLamps(project, scene.lighting, {
        accent: o.accent ?? (present.active && present.accent),
      }),
      windows: studioWindows(project),
    },
    glare: o.glare ?? false,
    viewProjection: viewProjectionOf(camera, aspect),
  });
  return { glb, sidecar };
}

/** One request body: 4 bytes (little endian) with the sidecar's length, the sidecar JSON, then the glb. */
export function packBundle(b: StudioBundle): Blob {
  const json = new TextEncoder().encode(JSON.stringify(b.sidecar));
  const head = new Uint8Array(4);
  new DataView(head.buffer).setUint32(0, json.length, true);
  return new Blob([head, json, b.glb], { type: 'application/octet-stream' });
}
