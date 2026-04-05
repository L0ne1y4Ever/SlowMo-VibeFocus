import {
  AddEquation,
  BufferAttribute,
  BufferGeometry,
  Camera,
  Color,
  CustomBlending,
  GLSL3,
  Group,
  HalfFloatType,
  LinearFilter,
  OneFactor,
  Points,
  RGBAFormat,
  RawShaderMaterial,
  Scene,
  WebGLRenderTarget,
} from 'three';
import type { Texture, WebGLRenderer } from 'three';
import type { ParticleTuning } from '../config/defaults';
import { RENDER_CONSTANTS } from '../config/defaults';
import type { AudioFrame } from '../audio/AudioInputManager';
import type { ProcessedImage } from '../image/ImageAnalyzer';
import { disposeRenderTarget } from '../utils/dispose';
import { hash11 } from '../utils/math';
import baseAccumVertexShader from './shaders/base-accum.vert.glsl?raw';
import baseAccumFragmentShader from './shaders/base-accum.frag.glsl?raw';

export class ParticleCloud {
  readonly group: Group;
  readonly baseScene: Scene;

  private baseGeometry: BufferGeometry;
  private readonly baseMaterial: RawShaderMaterial;
  private readonly basePoints: Points;
  private accumulationTarget: WebGLRenderTarget | null = null;

  constructor() {
    this.group = new Group();
    this.baseScene = new Scene();
    this.baseGeometry = new BufferGeometry();

    this.baseMaterial = this.createBaseMaterial();
    this.basePoints = new Points(this.baseGeometry, this.baseMaterial);
    this.basePoints.frustumCulled = false;
    this.baseScene.add(this.basePoints);
  }

  private createBaseMaterial() {
    return new RawShaderMaterial({
      glslVersion: GLSL3,
      vertexShader: baseAccumVertexShader,
      fragmentShader: baseAccumFragmentShader,
      transparent: true,
      depthWrite: false,
      depthTest: true,
      blending: CustomBlending,
      blendEquation: AddEquation,
      blendSrc: OneFactor,
      blendDst: OneFactor,
      uniforms: {
        uSourceImage: { value: null as Texture | null },
        uMouseTexture: { value: null as Texture | null },
        uTime: { value: 0 },
        uAudioLevel: { value: 0 },
        uAudioBass: { value: 0 },
        uAudioMid: { value: 0 },
        uAudioHigh: { value: 0 },
        uParticleSize: { value: 1.5 },
        uContrast: { value: 1.2 },
        uFlowSpeed: { value: 0.12 },
        uFlowAmplitude: { value: 0.008 },
        uDepthStrength: { value: 0.24 },
        uMouseStrength: { value: 0.28 },
        uEdgeLooseness: { value: 0.7 },
        uColorTint: { value: 0.86 },
        uAlphaGain: { value: 1.24 },
        uContentAspect: { value: 1.0 },
      },
    });
  }

  private createTarget(width: number, height: number): WebGLRenderTarget {
    const safeWidth = Math.max(1, Math.floor(width));
    const safeHeight = Math.max(1, Math.floor(height));
    return new WebGLRenderTarget(safeWidth, safeHeight, {
      type: HalfFloatType,
      format: RGBAFormat,
      depthBuffer: false,
      stencilBuffer: false,
      magFilter: LinearFilter,
      minFilter: LinearFilter,
    });
  }

  private ensureAccumulationTarget(width: number, height: number): void {
    if (this.accumulationTarget && this.accumulationTarget.width === width && this.accumulationTarget.height === height) {
      return;
    }

    disposeRenderTarget(this.accumulationTarget);
    this.accumulationTarget = this.createTarget(width, height);
  }

  private createGridGeometry(particleCount: number, analysis: ProcessedImage): BufferGeometry {
    const { contentFrame } = analysis;
    const positions = new Float32Array(particleCount * 3);
    const uvs = new Float32Array(particleCount * 2);
    const seeds = new Float32Array(particleCount);
    
    // We want a perfect mathematical grid
    const side = Math.ceil(Math.sqrt(particleCount * contentFrame.imageAspect));
    const rows = Math.ceil(particleCount / side);

    let idx = 0;
    for (let y = 0; y < rows; y++) {
      for (let x = 0; x < side; x++) {
        if (idx >= particleCount) break;

        const seed = hash11(idx + 1);
        const jx = hash11(idx * 2.1 + 13.0) - 0.5;
        const jy = hash11(idx * 3.4 + 17.0) - 0.5;

        // Apply a small random jitter to break the perfect grid (anti-moire)
        const jitter = 0.8;
        const u = (x + 0.5 + jx * jitter) / side;
        const v = (y + 0.5 + jy * jitter) / rows;

        positions[idx * 3] = (u - 0.5) * contentFrame.imageAspect;
        positions[idx * 3 + 1] = 0.5 - v;
        positions[idx * 3 + 2] = 0;

        uvs[idx * 2] = u;
        uvs[idx * 2 + 1] = v;

        seeds[idx] = seed;
        idx++;
      }
    }

    const geometry = new BufferGeometry();
    geometry.setAttribute('position', new BufferAttribute(positions, 3));
    geometry.setAttribute('uv', new BufferAttribute(uvs, 2));
    geometry.setAttribute('aSeed', new BufferAttribute(seeds, 1));
    return geometry;
  }

  rebuild(particleCount: number, analysis: ProcessedImage): void {
    this.baseGeometry.dispose();

    this.baseGeometry = this.createGridGeometry(particleCount, analysis);
    this.basePoints.geometry = this.baseGeometry;
    
    this.baseMaterial.uniforms.uContentAspect.value = analysis.contentFrame.imageAspect;
  }

  setSourceImage(texture: Texture): void {
    texture.minFilter = LinearFilter;
    texture.magFilter = LinearFilter;
    this.baseMaterial.uniforms.uSourceImage.value = texture;
  }

  setAnalysisTexture(texture: Texture): void {
    // Unused now but kept to not break SlowMoFocusApp.ts
  }

  setMouseTexture(texture: Texture): void {
    this.baseMaterial.uniforms.uMouseTexture.value = texture;
  }

  updateTime(elapsedSeconds: number): void {
    this.baseMaterial.uniforms.uTime.value = elapsedSeconds;
  }

  updateAudio(audio: AudioFrame): void {
    const u = this.baseMaterial.uniforms;
    u.uAudioLevel.value = audio.level;
    u.uAudioBass.value = audio.bass;
    u.uAudioMid.value = audio.mid;
    u.uAudioHigh.value = audio.high;
  }

  updateViewport(width: number, height: number): void {
    this.ensureAccumulationTarget(
      Math.floor(width * RENDER_CONSTANTS.baseAccumulationScale),
      Math.floor(height * RENDER_CONSTANTS.baseAccumulationScale),
    );
  }

  updateTuning(tuning: ParticleTuning): void {
    const baseUniforms = this.baseMaterial.uniforms;
    baseUniforms.uParticleSize.value = tuning.particleSize;
    baseUniforms.uContrast.value = tuning.contrast;
    baseUniforms.uFlowSpeed.value = tuning.flowSpeed;
    baseUniforms.uFlowAmplitude.value = tuning.flowAmplitude;
    baseUniforms.uDepthStrength.value = tuning.depthStrength;
    baseUniforms.uMouseStrength.value = tuning.mouseStrength;
    baseUniforms.uColorTint.value = tuning.colorTint;
    baseUniforms.uEdgeLooseness.value = tuning.edgeLooseness;
    baseUniforms.uAlphaGain.value = tuning.alphaGain;
  }

  renderBaseAccumulation(renderer: WebGLRenderer, camera: Camera): void {
    if (!this.accumulationTarget) {
      return;
    }

    const previousTarget = renderer.getRenderTarget();
    const previousAutoClear = renderer.autoClear;
    const previousClearAlpha = renderer.getClearAlpha();
    const previousClearColor = renderer.getClearColor(new Color());
    renderer.autoClear = true;
    renderer.setRenderTarget(this.accumulationTarget);
    renderer.setClearColor(0x000000, 0);
    renderer.clear(true, true, true);
    renderer.render(this.baseScene, camera);
    renderer.setRenderTarget(previousTarget);
    renderer.setClearColor(previousClearColor, previousClearAlpha);
    renderer.autoClear = previousAutoClear;
  }

  get baseAccumulationTexture(): Texture | null {
    return this.accumulationTarget?.texture ?? null;
  }

  dispose(): void {
    this.baseGeometry.dispose();
    this.baseMaterial.dispose();
    disposeRenderTarget(this.accumulationTarget);
  }
}
