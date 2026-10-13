/** The 3D camera's projection × view matrix, shared with the DOM label overlay (updated every frame by the scene). */
export interface LabelFrame {
  viewProjection: number[];
  width: number;
  height: number;
}
let frame: LabelFrame | null = null;
export const setLabelFrame = (f: LabelFrame | null): void => {
  frame = f;
};
export const getLabelFrame = (): LabelFrame | null => frame;
