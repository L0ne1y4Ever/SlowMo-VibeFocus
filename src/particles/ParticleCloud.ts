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
  OneMinusSrcAlphaFactor,
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
import { hash11, r2Sequence } from '../utils/math';
import baseAccumVertexShader from './shaders/base-accum.vert.glsl?raw';
import baseAccumFragmentShader from './shaders/base-accum.frag.glsl?raw';
import peelVertexShader from './shaders/peel.vert.glsl?raw';
import peelFragmentShader from './shaders/peel.frag.glsl?raw';

interface BaseSampleSet {
  readonly positions: Float32Array;
  readonly uvs: Float32Array;
  readonly seeds: Float32Array;
  readonly weights: Float32Array;
  readonly pixelIndices: Uint32Array;
  readonly count: number;
}

export class ParticleCloud {
  readonly group: Group;
  readonly baseScene: Scene;

  private baseGeometry: BufferGeometry;
  private peelGeometry: BufferGeometry;
  private readonly baseMaterial: RawShaderMaterial;
  private readonly peelMaterial: RawShaderMaterial;
  private readonly basePoints: Points;
  private readonly peelPoints: Points;
  private accumulationTarget: WebGLRenderTarget | null = null;

  constructor() {
    this.group = new Group();
    this.baseScene = new Scene();
    this.baseGeometry = new BufferGeometry();
    this.peelGeometry = new BufferGeometry();

    this.baseMaterial = this.createBaseMaterial();
    this.peelMaterial = this.createPeelMaterial();

    this.basePoints = new Points(this.baseGeometry, this.baseMaterial);
    this.basePoints.frustumCulled = false;
    this.basePoints.renderOrder = 4;
    this.baseScene.add(this.basePoints);

    this.peelPoints = new Points(this.peelGeometry, this.peelMaterial);
    this.peelPoints.frustumCulled = false;
    this.peelPoints.renderOrder = 16;
    this.group.add(this.peelPoints);
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
        uAnalysisTexture: { value: null as Texture | null },
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
        uColorTint: { value: 0.86 },
      },
    });
  }

  private createPeelMaterial() {
    return new RawShaderMaterial({
      glslVersion: GLSL3,
      vertexShader: peelVertexShader,
      fragmentShader: peelFragmentShader,
      transparent: true,
      depthWrite: false,
      depthTest: true,
      blending: CustomBlending,
      blendEquation: AddEquation,
      blendSrc: OneFactor,
      blendDst: OneMinusSrcAlphaFactor,
      uniforms: {
        uSourceImage: { value: null as Texture | null },
        uAnalysisTexture: { value: null as Texture | null },
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
        uEdgeLooseness: { value: 0.7 },
        uDepthStrength: { value: 0.24 },
        uMouseStrength: { value: 0.28 },
        uColorTint: { value: 0.86 },
        uAlphaGain: { value: 1.24 },
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

  private createWeightedSamples(
    particleCount: number,
    analysis: ProcessedImage,
    weightData: Float32Array,
    sequenceOffset: number,
    threshold: number,
    jitterScale: number,
  ): BaseSampleSet {
    const { analysisWidth, analysisHeight, contentFrame } = analysis;
    const positions = new Float32Array(particleCount * 3);
    const uvs = new Float32Array(particleCount * 2);
    const seeds = new Float32Array(particleCount);
    const weights = new Float32Array(particleCount);
    const pixelIndices = new Uint32Array(particleCount);

    const candidateIndices: number[] = [];
    const cumulativeWeights: number[] = [];
    let totalWeight = 0;

    for (let i = 0; i < weightData.length; i++) {
      const weight = weightData[i];
      if (weight < threshold) {
        continue;
      }

      totalWeight += weight;
      candidateIndices.push(i);
      cumulativeWeights.push(totalWeight);
    }

    if (candidateIndices.length === 0 || totalWeight <= 0) {
      const side = Math.ceil(Math.sqrt(particleCount));
      for (let i = 0; i < particleCount; i++) {
        const x = i % side;
        const y = Math.floor(i / side);
        const u = (x + 0.5) / side;
        const v = (y + 0.5) / side;
        positions[i * 3] = (u - 0.5) * contentFrame.imageAspect;
        positions[i * 3 + 1] = 0.5 - v;
        positions[i * 3 + 2] = 0;
        uvs[i * 2] = u;
        uvs[i * 2 + 1] = v;
        seeds[i] = hash11(i + 1);
        weights[i] = 1;
      }

      return { positions, uvs, seeds, weights, pixelIndices, count: particleCount };
    }

    const pickCandidate = (value: number): number => {
      let low = 0;
      let high = cumulativeWeights.length - 1;
      while (low < high) {
        const mid = (low + high) >> 1;
        if (value <= cumulativeWeights[mid]) {
          high = mid;
        } else {
          low = mid + 1;
        }
      }
      return low;
    };

    for (let i = 0; i < particleCount; i++) {
      const [uRand, vRand] = r2Sequence(i + 1 + sequenceOffset);
      const [jx, jy] = r2Sequence(i + 1 + sequenceOffset + particleCount);
      const sampleIndex = pickCandidate(uRand * totalWeight);
      const pixelIndex = candidateIndices[sampleIndex];
      const weight = weightData[pixelIndex];
      const px = pixelIndex % analysisWidth;
      const py = Math.floor(pixelIndex / analysisWidth);
      const jitterX = (jx - 0.5) * jitterScale;
      const jitterY = (jy - 0.5) * jitterScale;
      const u = (px + 0.5 + jitterX) / analysisWidth;
      const v = (py + 0.5 + jitterY) / analysisHeight;

      positions[i * 3] = ((u - contentFrame.centerU) / contentFrame.heightUV) * contentFrame.imageAspect;
      positions[i * 3 + 1] = (contentFrame.centerV - v) / contentFrame.heightUV;
      positions[i * 3 + 2] = 0;
      uvs[i * 2] = u;
      uvs[i * 2 + 1] = v;
      seeds[i] = hash11(pixelIndex * 0.37 + vRand * 157.0 + (i + sequenceOffset) * 0.13);
      weights[i] = weight;
      pixelIndices[i] = pixelIndex;
    }

    return { positions, uvs, seeds, weights, pixelIndices, count: particleCount };
  }

  private geometryFromBaseSamples(samples: BaseSampleSet): BufferGeometry {
    const geometry = new BufferGeometry();
    geometry.setAttribute('position', new BufferAttribute(samples.positions, 3));
    geometry.setAttribute('uv', new BufferAttribute(samples.uvs, 2));
    geometry.setAttribute('aSeed', new BufferAttribute(samples.seeds, 1));
    geometry.setAttribute('aWeight', new BufferAttribute(samples.weights, 1));
    return geometry;
  }

  private createPeelGeometry(
    samples: BaseSampleSet,
    analysis: ProcessedImage,
    targetCount: number,
  ): BufferGeometry {
    const candidateIndices: Array<{ index: number; priority: number; bias: number; phase: number }> = [];

    for (let i = 0; i < samples.count; i++) {
      const pixelIndex = samples.pixelIndices[i];
      const peelBias = analysis.peelEligibilityData[pixelIndex];
      if (peelBias < 0.055) {
        continue;
      }

      const seed = samples.seeds[i];
      const priority = hash11(seed * 113.7 + i * 0.17 + 41.0) / (peelBias + 0.04);
      candidateIndices.push({
        index: i,
        priority,
        bias: peelBias,
        phase: hash11(seed * 197.3 + i * 0.31 + 19.0),
      });
    }

    candidateIndices.sort((left, right) => left.priority - right.priority);
    const count = Math.min(targetCount, candidateIndices.length);

    const positions = new Float32Array(count * 3);
    const uvs = new Float32Array(count * 2);
    const seeds = new Float32Array(count);
    const weights = new Float32Array(count);
    const peelBiases = new Float32Array(count);
    const peelPhases = new Float32Array(count);
    for (let i = 0; i < count; i++) {
      const candidate = candidateIndices[i];
      const sourceIndex = candidate.index;
      positions[i * 3] = samples.positions[sourceIndex * 3];
      positions[i * 3 + 1] = samples.positions[sourceIndex * 3 + 1];
      positions[i * 3 + 2] = samples.positions[sourceIndex * 3 + 2];
      uvs[i * 2] = samples.uvs[sourceIndex * 2];
      uvs[i * 2 + 1] = samples.uvs[sourceIndex * 2 + 1];
      seeds[i] = samples.seeds[sourceIndex];
      weights[i] = samples.weights[sourceIndex];
      peelBiases[i] = candidate.bias;
      peelPhases[i] = candidate.phase;
    }

    const geometry = new BufferGeometry();
    geometry.setAttribute('position', new BufferAttribute(positions, 3));
    geometry.setAttribute('uv', new BufferAttribute(uvs, 2));
    geometry.setAttribute('aSeed', new BufferAttribute(seeds, 1));
    geometry.setAttribute('aWeight', new BufferAttribute(weights, 1));
    geometry.setAttribute('aPeelBias', new BufferAttribute(peelBiases, 1));
    geometry.setAttribute('aPeelPhase', new BufferAttribute(peelPhases, 1));
    return geometry;
  }

  rebuild(particleCount: number, analysis: ProcessedImage): void {
    this.baseGeometry.dispose();
    this.peelGeometry.dispose();

    const baseSamples = this.createWeightedSamples(
      particleCount,
      analysis,
      analysis.contentWeightData,
      particleCount,
      0.02,
      0.96,
    );
    this.baseGeometry = this.geometryFromBaseSamples(baseSamples);
    this.basePoints.geometry = this.baseGeometry;

    const peelCount = Math.min(Math.floor(particleCount * 0.14), 120_000);
    this.peelGeometry = this.createPeelGeometry(baseSamples, analysis, peelCount);
    this.peelPoints.geometry = this.peelGeometry;
  }

  setSourceImage(texture: Texture): void {
    texture.minFilter = LinearFilter;
    texture.magFilter = LinearFilter;
    this.baseMaterial.uniforms.uSourceImage.value = texture;
    this.peelMaterial.uniforms.uSourceImage.value = texture;
  }

  setAnalysisTexture(texture: Texture): void {
    this.baseMaterial.uniforms.uAnalysisTexture.value = texture;
    this.peelMaterial.uniforms.uAnalysisTexture.value = texture;
  }

  setMouseTexture(texture: Texture): void {
    this.baseMaterial.uniforms.uMouseTexture.value = texture;
    this.peelMaterial.uniforms.uMouseTexture.value = texture;
  }

  updateTime(elapsedSeconds: number): void {
    this.baseMaterial.uniforms.uTime.value = elapsedSeconds;
    this.peelMaterial.uniforms.uTime.value = elapsedSeconds;
  }

  updateAudio(audio: AudioFrame): void {
    const materials = [this.baseMaterial, this.peelMaterial];
    for (const material of materials) {
      const u = material.uniforms;
      u.uAudioLevel.value = audio.level;
      u.uAudioBass.value = audio.bass;
      u.uAudioMid.value = audio.mid;
      u.uAudioHigh.value = audio.high;
    }
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

    const peelUniforms = this.peelMaterial.uniforms;
    peelUniforms.uParticleSize.value = tuning.particleSize;
    peelUniforms.uContrast.value = tuning.contrast;
    peelUniforms.uFlowSpeed.value = tuning.flowSpeed;
    peelUniforms.uFlowAmplitude.value = tuning.flowAmplitude;
    peelUniforms.uEdgeLooseness.value = tuning.edgeLooseness;
    peelUniforms.uDepthStrength.value = tuning.depthStrength;
    peelUniforms.uMouseStrength.value = tuning.mouseStrength;
    peelUniforms.uColorTint.value = tuning.colorTint;
    peelUniforms.uAlphaGain.value = tuning.alphaGain;
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
    this.peelGeometry.dispose();
    this.baseMaterial.dispose();
    this.peelMaterial.dispose();
    disposeRenderTarget(this.accumulationTarget);
  }
}
