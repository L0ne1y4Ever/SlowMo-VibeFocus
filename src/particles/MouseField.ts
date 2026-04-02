import {
  GLSL3,
  HalfFloatType,
  LinearFilter,
  Mesh,
  OrthographicCamera,
  PlaneGeometry,
  RawShaderMaterial,
  RGBAFormat,
  Scene,
  Vector2,
  WebGLRenderTarget,
} from 'three';
import type { Texture, WebGLRenderer } from 'three';
import { RENDER_CONSTANTS } from '../config/defaults';
import fullscreenVertexShader from './shaders/fullscreen.vert.glsl?raw';
import mouseStampFragmentShader from './shaders/mouse-stamp.frag.glsl?raw';
import mouseDecayFragmentShader from './shaders/mouse-decay.frag.glsl?raw';
import { disposeRenderTarget } from '../utils/dispose';

export class MouseField {
  private readonly resolution: number;
  private readonly camera = new OrthographicCamera(-1, 1, 1, -1, 0, 1);
  private readonly scene = new Scene();
  private readonly quad: Mesh;
  private readonly stampMaterial: RawShaderMaterial;
  private readonly decayMaterial: RawShaderMaterial;
  private readonly targets: [WebGLRenderTarget, WebGLRenderTarget];
  private currentIndex = 0;
  private mouseUV = new Vector2(0.5, 0.5);
  private mouseActive = false;

  constructor(private readonly renderer: WebGLRenderer) {
    this.resolution = RENDER_CONSTANTS.mouseFieldResolution;
    const geometry = new PlaneGeometry(2, 2);

    this.stampMaterial = new RawShaderMaterial({
      glslVersion: GLSL3,
      vertexShader: fullscreenVertexShader,
      fragmentShader: mouseStampFragmentShader,
      uniforms: {
        uPrevField: { value: null as Texture | null },
        uMouseUV: { value: new Vector2(0.5, 0.5) },
        uMouseRadius: { value: 0.07 },
        uMouseActive: { value: 0.0 },
        uDelta: { value: 0.016 },
      },
    });

    this.decayMaterial = new RawShaderMaterial({
      glslVersion: GLSL3,
      vertexShader: fullscreenVertexShader,
      fragmentShader: mouseDecayFragmentShader,
      uniforms: {
        uField: { value: null as Texture | null },
        uTexelSize: { value: new Vector2(1 / this.resolution, 1 / this.resolution) },
        uDelta: { value: 0.016 },
      },
    });

    this.quad = new Mesh(geometry, this.stampMaterial);
    this.scene.add(this.quad);

    this.targets = [this.createTarget(), this.createTarget()];
  }

  private createTarget(): WebGLRenderTarget {
    return new WebGLRenderTarget(this.resolution, this.resolution, {
      type: HalfFloatType,
      format: RGBAFormat,
      depthBuffer: false,
      stencilBuffer: false,
      magFilter: LinearFilter,
      minFilter: LinearFilter,
    });
  }

  private render(material: RawShaderMaterial, target: WebGLRenderTarget): void {
    this.quad.material = material;
    this.renderer.setRenderTarget(target);
    this.renderer.render(this.scene, this.camera);
    this.renderer.setRenderTarget(null);
  }

  setMouseUV(uvX: number, uvY: number): void {
    this.mouseUV.set(uvX, uvY);
    this.mouseActive = true;
  }

  setMouseInactive(): void {
    this.mouseActive = false;
  }

  updateMouseRadius(radius: number): void {
    this.stampMaterial.uniforms.uMouseRadius.value = radius;
  }

  update(delta: number): void {
    const current = this.currentIndex;
    const next = 1 - current;
    const readTexture = this.targets[current].texture;

    // Pass 1: Decay + blur
    this.decayMaterial.uniforms.uField.value = readTexture;
    this.decayMaterial.uniforms.uDelta.value = delta;
    this.render(this.decayMaterial, this.targets[next]);

    // Pass 2: Stamp mouse brush
    this.stampMaterial.uniforms.uPrevField.value = this.targets[next].texture;
    this.stampMaterial.uniforms.uMouseUV.value.copy(this.mouseUV);
    this.stampMaterial.uniforms.uMouseActive.value = this.mouseActive ? 1.0 : 0.0;
    this.stampMaterial.uniforms.uDelta.value = delta;
    this.render(this.stampMaterial, this.targets[current]);

    // current target now holds the final result (no index swap needed)
  }

  get texture(): Texture {
    return this.targets[this.currentIndex].texture;
  }

  dispose(): void {
    (this.quad.geometry as PlaneGeometry).dispose();
    this.stampMaterial.dispose();
    this.decayMaterial.dispose();
    disposeRenderTarget(this.targets[0]);
    disposeRenderTarget(this.targets[1]);
  }
}
