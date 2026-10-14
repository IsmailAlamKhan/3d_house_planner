/** The rectified plan picture as the pipeline sees it: a size and a way to cut out a piece at a given resolution. */
export interface PictureSource {
  width: number;
  height: number;
  /** A piece of the picture ([x, y, w, h] in pixels), scaled so its longer side is at most `maxSide`, as base64 JPEG/PNG. */
  crop(box: { x: number; y: number; w: number; h: number }, maxSide: number): Promise<string>;
}

/** A browser canvas (or any image drawable) as a `PictureSource`. */
export function canvasSource(canvas: HTMLCanvasElement): PictureSource {
  return {
    width: canvas.width,
    height: canvas.height,
    async crop(box, maxSide) {
      const k = Math.min(1, maxSide / Math.max(box.w, box.h));
      const out = document.createElement('canvas');
      out.width = Math.max(1, Math.round(box.w * k));
      out.height = Math.max(1, Math.round(box.h * k));
      const ctx = out.getContext('2d');
      if (!ctx) throw new Error('This browser cannot draw pictures.');
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, out.width, out.height);
      ctx.drawImage(canvas, box.x, box.y, box.w, box.h, 0, 0, out.width, out.height);
      return out.toDataURL('image/jpeg', 0.92).replace(/^data:image\/jpeg;base64,/, '');
    },
  };
}
