import template from '../comfy/workflows/enhance_sdxl.json';
import type { EnhanceParams } from '../../src/render/protocol';

type Node = { class_type: string; inputs: Record<string, unknown> };
type Prompt = Record<string, Node>;

/** Version of the workflow template (stored with every result). */
export const WORKFLOW_VERSION: number = template.version;

export interface WorkflowFiles {
  color: string;
  depth: string;
  edge?: string;
}

/**
 * Fills the versioned ComfyUI API workflow with the user's parameters. Without an edge image the canny ControlNet is
 * left out; without `upscale` the second pass is left out. Pure: returns a new object.
 */
export function buildWorkflow(params: EnhanceParams, files: WorkflowFiles): Prompt {
  const p = JSON.parse(JSON.stringify(template.prompt)) as Prompt;
  p['2']!.inputs.image = files.color;
  p['3']!.inputs.image = files.depth;
  p['7']!.inputs.text = params.prompt;
  p['8']!.inputs.text = params.negative;
  p['9']!.inputs.strength = params.controlStrength;
  const sampler = p['12']!.inputs;
  sampler.seed = params.seed;
  sampler.steps = params.steps;
  sampler.denoise = params.creativity;

  if (files.edge) {
    p['4']!.inputs.image = files.edge;
    p['10']!.inputs.strength = Math.min(1, params.controlStrength * 0.6);
  } else {
    delete p['4'];
    delete p['6'];
    delete p['10'];
    sampler.positive = ['9', 0];
    sampler.negative = ['9', 1];
    p['17']!.inputs.positive = ['9', 0];
    p['17']!.inputs.negative = ['9', 1];
  }

  if (params.upscale) {
    p['17']!.inputs.seed = params.seed;
    p['14']!.inputs.images = ['18', 0];
  } else {
    delete p['15'];
    delete p['16'];
    delete p['17'];
    delete p['18'];
  }
  return p;
}
