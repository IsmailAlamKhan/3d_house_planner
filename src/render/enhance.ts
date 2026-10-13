import { captureScene } from '../export/bridge';
import { withScene } from '../export/scene';
import { useModel } from '../model/store';
import { roomLabels } from '../present/labels';
import { usePresent } from '../present/presentStore';
import { visibleLevelIds } from '../present/LabelsOverlay';
import { computeEdges } from './edges';
import { type EnhanceParams, type EnhanceRequest } from './protocol';

/** Long side of the pictures sent to the image model (SDXL works best around 1024). */
export const INPUT_LONG_SIDE = 1024;

const toBlobUrl = async (blob: Blob): Promise<string> =>
  new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result));
    r.onerror = () => reject(r.error);
    r.readAsDataURL(blob);
  });

async function pixels(blob: Blob): Promise<ImageData> {
  const bmp = await createImageBitmap(blob);
  const c = document.createElement('canvas');
  c.width = bmp.width;
  c.height = bmp.height;
  const ctx = c.getContext('2d', { willReadFrequently: true })!;
  ctx.drawImage(bmp, 0, 0);
  return ctx.getImageData(0, 0, c.width, c.height);
}

async function toPng(data: ImageData): Promise<Blob> {
  const c = document.createElement('canvas');
  c.width = data.width;
  c.height = data.height;
  c.getContext('2d')!.putImageData(data, 0, 0);
  return new Promise((resolve, reject) =>
    c.toBlob(
      (b) => (b ? resolve(b) : reject(new Error('The picture could not be created.'))),
      'image/png',
    ),
  );
}

export interface EnhanceInputs {
  color: string;
  depth: string;
  edge?: string;
  view: EnhanceRequest['view'];
}

/**
 * Renders the pictures the image model needs, all from the same camera: the presentation colour render WITHOUT labels,
 * a normalised depth pass (near = white) and, optionally, an edge pass.
 */
export async function captureEnhanceInputs(withEdges: boolean): Promise<EnhanceInputs> {
  const present = usePresent.getState();
  return withScene(async () => {
    const base = {
      scale: 1 as const,
      format: 'png' as const,
      transparent: false,
      presentation: true,
      longSide: INPUT_LONG_SIDE,
    };
    const color = await captureScene({ ...base, fx: present.active && present.fx });
    const depth = await captureScene({ ...base, pass: 'depth' });
    let edge: string | undefined;
    if (withEdges) {
      const normals = await captureScene({ ...base, pass: 'normals' });
      const n = await pixels(normals.blob);
      const d = await pixels(depth.blob);
      const lines = computeEdges(n.width, n.height, n.data, d.width === n.width ? d.data : null);
      edge = await toBlobUrl(await toPng(new ImageData(lines, n.width, n.height)));
    }
    return {
      color: await toBlobUrl(color.blob),
      depth: await toBlobUrl(depth.blob),
      edge,
      view: { viewProjection: color.viewProjection, width: color.width, height: color.height },
    };
  });
}

/** The room labels as they are in the picture (stored with the result so they can be re-applied). */
export function currentLabels(): EnhanceRequest['labels'] {
  const project = useModel.getState().project;
  const { labels, hiddenLabels } = usePresent.getState();
  return roomLabels(project, {
    mode: labels.mode,
    hidden: new Set(hiddenLabels),
    levelIds: visibleLevelIds(project),
  });
}

export function buildRequest(params: EnhanceParams, inputs: EnhanceInputs): EnhanceRequest {
  const project = useModel.getState().project;
  return {
    projectId: project.id,
    projectName: project.name,
    params,
    images: { color: inputs.color, depth: inputs.depth, edge: inputs.edge },
    view: inputs.view,
    labels: currentLabels(),
  };
}

export const randomSeed = (): number => Math.floor(Math.random() * 2 ** 32);
