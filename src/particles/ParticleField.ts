import {
  AddEquation,
  BufferAttribute,
  CustomBlending,
  DoubleSide,
  Group,
  InstancedBufferAttribute,
  InstancedBufferGeometry,
  Mesh,
  OneFactor,
  OneMinusSrcAlphaFactor,
  RawShaderMaterial,
  Vector2,
} from 'three';
import type { Texture } from 'three';
import { GLSL3 } from 'three';
import type { ParticleTuning } from '../config/defaults';
import { densityScale } from '../config/defaults';
import type { ProcessedParticleImage } from '../image/ImagePreprocessor';
import particleFragmentShader from './shaders/particle.frag.glsl?raw';
import particleVertexShader from './shaders/particle.vert.glsl?raw';
import { disposeObject3D } from '../utils/dispose';

function createGeometry(resolution: number): InstancedBufferGeometry {
  const geometry = new InstancedBufferGeometry();
  geometry.setAttribute(
    'position',
    new BufferAttribute(
      new Float32Array([
        -1, -1, 0,
        1, -1, 0,
        1, 1, 0,
        -1, 1, 0,
      ]),
      3,
    ),
  );
  geometry.setAttribute(
    'uv',
    new BufferAttribute(
      new Float32Array([
        0, 0,
        1, 0,
        1, 1,
        0, 1,
      ]),
      2,
    ),
  );
  geometry.setIndex([0, 1, 2, 0, 2, 3]);

  const particleUvs = new Float32Array(resolution * resolution * 2);
  for (let y = 0; y < resolution; y += 1) {
    for (let x = 0; x < resolution; x += 1) {
      const index = y * resolution + x;
      const offset = index * 2;
      particleUvs[offset] = (x + 0.5) / resolution;
      particleUvs[offset + 1] = (y + 0.5) / resolution;
    }
  }

  geometry.setAttribute('aParticleUv', new InstancedBufferAttribute(particleUvs, 2));
  geometry.instanceCount = resolution * resolution;
  return geometry;
}

function createMaterial(): RawShaderMaterial {
  return new RawShaderMaterial({
    glslVersion: GLSL3,
    vertexShader: particleVertexShader,
    fragmentShader: particleFragmentShader,
    transparent: true,
    depthWrite: false,
    depthTest: false,
    side: DoubleSide,
    premultipliedAlpha: true,
    blending: CustomBlending,
    blendEquation: AddEquation,
    blendSrc: OneFactor,
    blendDst: OneMinusSrcAlphaFactor,
    uniforms: {
      uPositionTexture: { value: null as Texture | null },
      uAnchorTexture: { value: null as Texture | null },
      uColorTexture: { value: null as Texture | null },
      uMetaTexture: { value: null as Texture | null },
      uParticleSize: { value: 4 },
      uDensityScale: { value: 1 },
      uBrightness: { value: 1 },
      uAlphaGain: { value: 1 },
      uViewport: { value: new Vector2(1, 1) },
    },
  });
}

export class ParticleField {
  readonly group = new Group();
  private mesh: Mesh<InstancedBufferGeometry, RawShaderMaterial> | null = null;
  private material: RawShaderMaterial | null = null;
  private geometry: InstancedBufferGeometry | null = null;
  private particleCount = 0;

  rebuild(data: ProcessedParticleImage): void {
    this.disposeRenderable();

    this.geometry = createGeometry(data.resolution);
    this.material = createMaterial();
    this.material.uniforms.uAnchorTexture.value = data.anchorTexture;
    this.material.uniforms.uColorTexture.value = data.colorTexture;
    this.material.uniforms.uMetaTexture.value = data.metaTexture;

    this.mesh = new Mesh(this.geometry, this.material);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 10;
    this.group.add(this.mesh);
    this.particleCount = data.particleCount;
  }

  setSimulationTexture(positionTexture: Texture): void {
    if (this.material) {
      this.material.uniforms.uPositionTexture.value = positionTexture;
    }
  }

  updateViewport(width: number, height: number): void {
    this.material?.uniforms.uViewport.value.set(width, height);
  }

  updateTuning(tuning: ParticleTuning): void {
    if (!this.material) {
      return;
    }

    this.material.uniforms.uParticleSize.value = tuning.particleSize;
    this.material.uniforms.uDensityScale.value = densityScale(this.particleCount, tuning.densityCompensation);
    this.material.uniforms.uBrightness.value = tuning.brightness;
    this.material.uniforms.uAlphaGain.value = tuning.alphaGain;
  }

  private disposeRenderable(): void {
    if (!this.mesh) {
      return;
    }

    disposeObject3D(this.mesh);
    this.group.remove(this.mesh);
    this.mesh = null;
    this.material = null;
    this.geometry = null;
  }

  dispose(): void {
    this.disposeRenderable();
  }
}
