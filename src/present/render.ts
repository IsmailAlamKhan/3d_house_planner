import { type CaptureResult, captureScene } from '../export/bridge';
import { downloadBlob, safeFileName } from '../export/download';
import { withScene } from '../export/scene';
import { t } from '../i18n';
import { useModel } from '../model/store';
import { drawLabels, projectLabels, roomLabels } from './labels';
import { visibleLevelIds } from './LabelsOverlay';
import { usePresent } from './presentStore';
import { skyFor, sunAt, sunVisible, moonAt, timeOf } from '../scene3d/lighting';
import { useSceneStore } from '../scene3d/sceneStore';

export interface PresentExportOptions {
  scale: 1 | 2 | 4;
  /** Composite the room labels on the picture. */
  labels: boolean;
  transparent: boolean;
  /** Path-trace instead of the normal presentation render. */
  pathTrace: boolean;
  signal?: AbortSignal;
}

export interface PresentExportResult {
  blob: Blob;
  width: number;
  height: number;
  /** Set when the path tracer could not run and the normal render was used. */
  fallback?: string;
  cancelled?: boolean;
}

/** The corner footer that says what the picture is. */
export const WATERMARK = 'Design render — indicative only';

function loadImage(blob: Blob): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(blob);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve(img);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error(t('present.err.image')));
    };
    img.src = url;
  });
}

/** Draws the label overlay and the footer onto a rendered picture and returns the final PNG. */
export async function composePicture(
  base: CaptureResult,
  opts: { labels: boolean },
): Promise<Blob> {
  const project = useModel.getState().project;
  const { labels, hiddenLabels } = usePresent.getState();
  const img = await loadImage(base.blob);
  const canvas = document.createElement('canvas');
  canvas.width = base.width;
  canvas.height = base.height;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error(t('present.err.image'));
  ctx.drawImage(img, 0, 0);
  if (opts.labels && labels.show) {
    const items = roomLabels(project, {
      mode: labels.mode,
      hidden: new Set(hiddenLabels),
      levelIds: visibleLevelIds(project),
    });
    drawLabels(
      ctx,
      projectLabels(items, base.viewProjection, base.width, base.height),
      labels,
      base.width,
      base.height,
    );
  }
  // Footer watermark.
  const px = Math.max(11, Math.round(Math.min(base.width, base.height) * 0.016));
  ctx.font = `500 ${px}px system-ui, sans-serif`;
  const w = ctx.measureText(WATERMARK).width + px * 1.6;
  ctx.fillStyle = 'rgba(15,23,42,0.55)';
  ctx.fillRect(base.width - w, base.height - px * 2, w, px * 2);
  ctx.fillStyle = '#fff';
  ctx.textAlign = 'right';
  ctx.textBaseline = 'middle';
  ctx.fillText(WATERMARK, base.width - px * 0.8, base.height - px);
  return new Promise<Blob>((resolve, reject) =>
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error(t('present.err.image')))), 'image/png'),
  );
}

/** Takes the presentation picture of the 3D view as it is now: effects, labels and the footer included. */
export async function renderPresentation(o: PresentExportOptions): Promise<PresentExportResult> {
  const present = usePresent.getState();
  const lighting = useSceneStore.getState().lighting;
  const compass = useModel.getState().project.settings.compass;
  const sun = sunVisible(lighting) ? sunAt(timeOf(lighting), compass) : moonAt(compass);
  const sky = skyFor(lighting, sun);
  const base = await withScene(() =>
    captureScene({
      scale: o.scale,
      format: 'png',
      transparent: o.transparent,
      presentation: true,
      fx: present.active && present.fx && !o.pathTrace,
      pathTrace: o.pathTrace
        ? {
            target: usePresent.getState().pathTrace.target,
            onProgress: (samples) => usePresent.getState().setPathTrace({ samples }),
            signal: o.signal ?? new AbortController().signal,
            background: sky.horizon,
          }
        : undefined,
    }),
  );
  if (base.pathTraced === 'cancelled') {
    return { blob: base.blob, width: base.width, height: base.height, cancelled: true };
  }
  const blob = await composePicture(base, { labels: o.labels });
  return { blob, width: base.width, height: base.height, fallback: base.fallback };
}

/** Renders and saves the picture. */
export async function exportPresentation(o: PresentExportOptions): Promise<PresentExportResult> {
  const r = await renderPresentation(o);
  if (!r.cancelled) {
    const name = safeFileName(useModel.getState().project.name);
    downloadBlob(r.blob, `${name}-render${o.scale > 1 ? `@${o.scale}x` : ''}.png`);
  }
  return r;
}
