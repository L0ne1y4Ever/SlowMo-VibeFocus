import { Vector2 } from 'three';
import type { Camera, Scene, Texture, WebGLRenderer } from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import type { ParticleTuning } from '../config/defaults';
import chromaticFragmentShader from './shaders/chromatic.frag.glsl?raw';
import baseCompositeFragmentShader from './shaders/base-composite.frag.glsl?raw';

const ChromaticAberrationShader = {
  name: 'ChromaticAberrationShader',
  uniforms: {
    tDiffuse: { value: null },
    uOffset: { value: new Vector2(1.5, 1.5) },
    uResolution: { value: new Vector2(1, 1) },
  },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `,
  fragmentShader: chromaticFragmentShader,
};

const BaseCompositeShader = {
  name: 'BaseCompositeShader',
  uniforms: {
    tDiffuse: { value: null },
    tBaseAccum: { value: null as Texture | null },
    uAlphaGain: { value: 1.0 },
  },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `,
  fragmentShader: baseCompositeFragmentShader,
};

export class PostStack {
  private readonly composer: EffectComposer;
  private readonly baseCompositePass: ShaderPass;
  private readonly bloomPass: UnrealBloomPass;
  private readonly chromaticPass: ShaderPass;
  private readonly renderPass: RenderPass;

  constructor(renderer: WebGLRenderer, scene: Scene, camera: Camera) {
    this.composer = new EffectComposer(renderer);

    this.baseCompositePass = new ShaderPass(BaseCompositeShader);
    this.composer.addPass(this.baseCompositePass);

    this.renderPass = new RenderPass(scene, camera);
    this.renderPass.clear = false;
    this.composer.addPass(this.renderPass);

    const size = renderer.getSize(new Vector2());
    this.bloomPass = new UnrealBloomPass(size, 0.6, 0.4, 0.82);
    this.composer.addPass(this.bloomPass);

    this.chromaticPass = new ShaderPass(ChromaticAberrationShader);
    this.composer.addPass(this.chromaticPass);

    const outputPass = new OutputPass();
    this.composer.addPass(outputPass);
  }

  updateCamera(camera: Camera): void {
    this.renderPass.camera = camera;
  }

  setBaseAccumulationTexture(texture: Texture | null): void {
    this.baseCompositePass.uniforms['tBaseAccum'].value = texture;
  }

  updateTuning(tuning: ParticleTuning): void {
    this.baseCompositePass.uniforms['uAlphaGain'].value = tuning.alphaGain;
    this.bloomPass.strength = tuning.bloomStrength;
    this.bloomPass.radius = tuning.bloomRadius;
    this.bloomPass.threshold = tuning.bloomThreshold;
    const offset = tuning.chromaticAberration;
    this.chromaticPass.uniforms['uOffset'].value.set(offset, offset);
  }

  resize(width: number, height: number): void {
    this.composer.setSize(width, height);
    this.chromaticPass.uniforms['uResolution'].value.set(width, height);
  }

  render(delta: number): void {
    this.composer.render(delta);
  }

  dispose(): void {
    this.composer.dispose();
  }
}
