import {
  HalfFloatType,
  LinearFilter,
  RGBAFormat,
  ShaderMaterial,
  type Texture,
  Vector2,
  WebGLRenderTarget,
  type WebGLRenderer,
} from 'three';
import { FullScreenQuad } from 'three/examples/jsm/postprocessing/Pass.js';

/**
 * Cleans up a finished path-traced picture: 1) "fireflies" (single pixels far brighter than all their neighbours, the
 * typical noise of small lamps and bounced light) are pulled down to their surroundings; 2) a small edge-preserving
 * blur smooths the remaining grain without smearing edges. Works on the linear image, before tone mapping.
 */
const MATERIAL = () =>
  new ShaderMaterial({
    uniforms: { map: { value: null as Texture | null }, texel: { value: new Vector2(1, 1) } },
    vertexShader: /* glsl */ `
      varying vec2 vUv;
      void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }
    `,
    fragmentShader: /* glsl */ `
      uniform sampler2D map;
      uniform vec2 texel;
      varying vec2 vUv;
      float lum(vec3 c) { return dot(c, vec3(0.2126, 0.7152, 0.0722)); }
      vec3 fetch(vec2 o) { return texture2D(map, vUv + o * texel).rgb; }
      vec3 despeckled(vec2 o) {
        vec3 c = fetch(o);
        float sum = 0.0;
        for (int y = -1; y <= 1; y++) for (int x = -1; x <= 1; x++) {
          if (x == 0 && y == 0) continue;
          sum += lum(fetch(o + vec2(float(x), float(y))));
        }
        float limit = (sum / 8.0) * 1.8 + 0.02;
        float l = lum(c);
        return l > limit ? c * (limit / l) : c;
      }
      void main() {
        vec3 c = despeckled(vec2(0.0));
        float scale = lum(c) + 0.08;
        vec3 acc = vec3(0.0);
        float wsum = 0.0;
        for (int y = -3; y <= 3; y++) for (int x = -3; x <= 3; x++) {
          vec2 o = vec2(float(x), float(y));
          vec3 n = despeckled(o);
          vec3 d = (n - c) / scale;
          float w = exp(-dot(o, o) / (2.0 * 2.4 * 2.4)) * exp(-dot(d, d) / (2.0 * 0.3 * 0.3));
          acc += n * w;
          wsum += w;
        }
        gl_FragColor = vec4(acc / wsum, 1.0);
      }
    `,
    depthTest: false,
    depthWrite: false,
  });

export class Denoiser {
  private quad = new FullScreenQuad(MATERIAL());
  private target: WebGLRenderTarget | null = null;

  /** Filters `src` and returns the cleaned texture (valid until the next call or `dispose`). */
  apply(renderer: WebGLRenderer, src: WebGLRenderTarget): Texture {
    if (!this.target || this.target.width !== src.width || this.target.height !== src.height) {
      this.target?.dispose();
      this.target = new WebGLRenderTarget(src.width, src.height, {
        type: HalfFloatType,
        format: RGBAFormat,
        minFilter: LinearFilter,
        magFilter: LinearFilter,
        depthBuffer: false,
      });
    }
    const m = this.quad.material as ShaderMaterial;
    m.uniforms.map!.value = src.texture;
    (m.uniforms.texel!.value as Vector2).set(1 / src.width, 1 / src.height);
    const prev = renderer.getRenderTarget();
    renderer.setRenderTarget(this.target);
    this.quad.render(renderer);
    renderer.setRenderTarget(prev);
    return this.target.texture;
  }

  dispose(): void {
    this.target?.dispose();
    this.quad.material.dispose();
    this.quad.dispose();
  }
}
