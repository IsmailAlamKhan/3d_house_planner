import { useModel } from '../model/store';
import { applyLook, enterPresent } from '../present/actions';
import { usePresent } from '../present/presentStore';
import type { StudioBundleOptions } from './bundle';
import type { StudioQuality } from './protocol';

/** Warm white of the interior lamps in the Reference look. */
export const REFERENCE_KELVIN = 2700;

/**
 * The "Reference look": the mood of the reference picture in one click. Dusk sky, every light on (interior, garden
 * uplights, pool lights), warm 2700 K, soft accent lights, a slight glow around bright lights, the plan seen from above
 * with ceilings and roofs cut away. The camera is the saved view "Reference top-down" when the project has one, else the
 * cutaway top view. Switches presentation mode on and returns the bundle options.
 */
export function applyReferenceLook(quality: StudioQuality): StudioBundleOptions {
  enterPresent('cutaway-top');
  applyLook('dusk');
  usePresent.getState().patch({ accent: true });
  const view = useModel.getState().project.views.find((v) => /reference top-?down/i.test(v.name));
  return {
    quality,
    look: 'reference',
    glare: true,
    accent: true,
    exposure: 1.0,
    kelvin: REFERENCE_KELVIN,
    view,
  };
}
