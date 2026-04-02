import {
  AddEquation,
  BufferAttribute,
  BufferGeometry,
  CustomBlending,
  GLSL3,
  LinearFilter,
  OneFactor,
  OneMinusSrcAlphaFactor,
  Points,
  RawShaderMaterial,
  Vector2,
} from 'three';
import type { Texture } from 'three';
import type { ParticleTuning } from '../config/defaults';
import cloudVertexShader from './shaders/cloud.vert.glsl?raw';
import cloudFragmentShader from './shaders/cloud.frag.glsl?raw';

export class ParticleCloud {
  readonly points: Points;
  private material: RawShaderMaterial;
  private geometry: BufferGeometry;

  constructor() {
    this.geometry = new BufferGeometry();
    this.material = this.createMaterial();
    this.points = new Points(this.geometry, this.material);
    this.points.frustumCulled = false;
    this.points.renderOrder = 10;
  }

  private createMaterial(): RawShaderMaterial {
    return new RawShaderMaterial({
      glslVersion: GLSL3,
      vertexShader: cloudVertexShader,
      fragmentShader: cloudFragmentShader,
      transparent: true,
      depthWrite: false,
      depthTest: true,
      // Premultiplied alpha blending: preserves color, doesn't wash out
      blending: CustomBlending,
      blendEquation: AddEquation,
      blendSrc: OneFactor,
      blendDst: OneMinusSrcAlphaFactor,
      uniforms: {
        uSourceImage: { value: null as Texture | null },
        uMaskTexture: { value: null as Texture | null },
        uMouseTexture: { value: null as Texture | null },
        uTime: { value: 0 },
        uParticleSize: { value: 2.0 },
        uContrast: { value: 1.5 },
        uFlowSpeed: { value: 0.12 },
        uFlowAmplitude: { value: 0.006 },
        uEdgeLooseness: { value: 0.7 },
        uDepthStrength: { value: 0.3 },
        uMouseStrength: { value: 0.3 },
        uColorTint: { value: 0.5 },
        uAlphaGain: { value: 1.0 },
        uResolution: { value: new Vector2(1, 1) },
      },
    });
  }

  rebuild(gridX: number, gridY: number, aspect: number): void {
    this.geometry.dispose();
    this.geometry = new BufferGeometry();
    this.points.geometry = this.geometry;

    const count = gridX * gridY;
    const positions = new Float32Array(count * 3);
    const uvs = new Float32Array(count * 2);
    const seeds = new Float32Array(count);

    const hashSeed = (i: number): number => {
      const x = Math.sin(i * 127.1 + 311.7) * 43758.5453123;
      return x - Math.floor(x);
    };

    for (let iy = 0; iy < gridY; iy++) {
      for (let ix = 0; ix < gridX; ix++) {
        const idx = iy * gridX + ix;
        const u = (ix + 0.5) / gridX;
        const v = (iy + 0.5) / gridY;

        positions[idx * 3] = (u - 0.5) * aspect;
        positions[idx * 3 + 1] = 0.5 - v;
        positions[idx * 3 + 2] = 0;

        uvs[idx * 2] = u;
        uvs[idx * 2 + 1] = v;

        seeds[idx] = hashSeed(idx);
      }
    }

    this.geometry.setAttribute('position', new BufferAttribute(positions, 3));
    this.geometry.setAttribute('uv', new BufferAttribute(uvs, 2));
    this.geometry.setAttribute('aSeed', new BufferAttribute(seeds, 1));
  }

  setSourceImage(texture: Texture): void {
    texture.minFilter = LinearFilter;
    texture.magFilter = LinearFilter;
    this.material.uniforms.uSourceImage.value = texture;
  }

  setMaskTexture(texture: Texture): void {
    this.material.uniforms.uMaskTexture.value = texture;
  }

  setMouseTexture(texture: Texture): void {
    this.material.uniforms.uMouseTexture.value = texture;
  }

  updateTime(elapsedSeconds: number): void {
    this.material.uniforms.uTime.value = elapsedSeconds;
  }

  updateViewport(width: number, height: number): void {
    this.material.uniforms.uResolution.value.set(width, height);
  }

  updateTuning(tuning: ParticleTuning): void {
    const u = this.material.uniforms;
    u.uParticleSize.value = tuning.particleSize;
    u.uContrast.value = tuning.contrast;
    u.uFlowSpeed.value = tuning.flowSpeed;
    u.uFlowAmplitude.value = tuning.flowAmplitude;
    u.uEdgeLooseness.value = tuning.edgeLooseness;
    u.uDepthStrength.value = tuning.depthStrength;
    u.uMouseStrength.value = tuning.mouseStrength;
    u.uColorTint.value = tuning.colorTint;
    u.uAlphaGain.value = tuning.alphaGain;
  }

  dispose(): void {
    this.geometry.dispose();
    this.material.dispose();
  }
}
