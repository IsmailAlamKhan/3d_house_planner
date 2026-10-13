import { drawLabels, type LabelStyle, projectLabels, type RoomLabel } from '../present/labels';

/** The corner badge on every enhanced image. */
export const AI_BADGE = 'AI-enhanced mood image — not to scale';

function load(src: string | Blob): Promise<{ img: HTMLImageElement; revoke: () => void }> {
  return new Promise((resolve, reject) => {
    const url = typeof src === 'string' ? src : URL.createObjectURL(src);
    const img = new Image();
    img.onload = () =>
      resolve({ img, revoke: () => typeof src !== 'string' && URL.revokeObjectURL(url) });
    img.onerror = () => reject(new Error('The picture could not be loaded.'));
    img.src = url;
  });
}

export interface ComposeOptions {
  /** Labels to draw (re-projected with the stored camera, so they are crisp and in the right place). */
  labels: RoomLabel[] | null;
  viewProjection: number[];
  style: LabelStyle;
  /** Add the "AI-enhanced" corner badge (always for enhanced images, never for the exact render). */
  badge: boolean;
}

/** Draws crisp vector labels (and the badge) over a picture and returns a PNG. The AI image itself is never edited. */
export async function composeOver(src: string | Blob, o: ComposeOptions): Promise<Blob> {
  const { img, revoke } = await load(src);
  try {
    const canvas = document.createElement('canvas');
    canvas.width = img.naturalWidth;
    canvas.height = img.naturalHeight;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('The picture could not be created.');
    ctx.drawImage(img, 0, 0);
    if (o.labels && o.style.show) {
      drawLabels(
        ctx,
        projectLabels(o.labels, o.viewProjection, canvas.width, canvas.height),
        o.style,
        canvas.width,
        canvas.height,
      );
    }
    if (o.badge) {
      const px = Math.max(11, Math.round(Math.min(canvas.width, canvas.height) * 0.016));
      ctx.font = `500 ${px}px system-ui, sans-serif`;
      const w = ctx.measureText(AI_BADGE).width + px * 1.6;
      ctx.fillStyle = 'rgba(15,23,42,0.62)';
      ctx.fillRect(canvas.width - w, canvas.height - px * 2, w, px * 2);
      ctx.fillStyle = '#fff';
      ctx.textAlign = 'right';
      ctx.textBaseline = 'middle';
      ctx.fillText(AI_BADGE, canvas.width - px * 0.8, canvas.height - px);
    }
    return await new Promise<Blob>((resolve, reject) =>
      canvas.toBlob(
        (b) => (b ? resolve(b) : reject(new Error('The picture could not be created.'))),
        'image/png',
      ),
    );
  } finally {
    revoke();
  }
}
