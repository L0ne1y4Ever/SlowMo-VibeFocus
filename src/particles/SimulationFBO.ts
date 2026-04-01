import {
  GLSL3,
  HalfFloatType,
  Mesh,
  NearestFilter,
  OrthographicCamera,
  PlaneGeometry,
  RGBAFormat,
  RawShaderMaterial,
  Scene,
  WebGLRenderTarget,
  WebGLRenderer,
} from 'three';
import type { ProcessedParticleImage } from '../image/ImagePreprocessor';
import type { ParticleTuning } from '../config/defaults';
import copyFragmentShader from './shaders/copy.frag.glsl?raw';
import fullscreenVertexShader from './shaders/fullscreen.vert.glsl?raw';
import integratePositionFragmentShader from './shaders/integrate-position.frag.glsl?raw';
import simulateVelocityFragmentShader from './shaders/simulate-velocity.frag.glsl?raw';
import { disposeRenderTarget } from '../utils/dispose';

function createRenderTarget(resolution: number): WebGLRenderTarget {
  return new WebGLRenderTarget(resolution, resolution, {
    type: HalfFloatType,
    format: RGBAFormat,
    depthBuffer: false,
    stencilBuffer: false,
    magFilter: NearestFilter,
    minFilter: NearestFilter,
  });
}

export class SimulationFBO {
  private readonly camera = new OrthographicCamera(-1, 1, 1, -1, 0, 1);
  private readonly scene = new Scene();
  private readonly quad: Mesh;
  private readonly copyMaterial: RawShaderMaterial;
  private readonly velocityMaterial: RawShaderMaterial;
  private readonly positionMaterial: RawShaderMaterial;
  private readonly positionTargets: [WebGLRenderTarget, WebGLRenderTarget];
  private readonly velocityTargets: [WebGLRenderTarget, WebGLRenderTarget];
  private currentIndex = 0;

  constructor(
    private readonly renderer: WebGLRenderer,
    readonly resolution: number,
  ) {
    const geometry = new PlaneGeometry(2, 2);

    this.copyMaterial = new RawShaderMaterial({
      glslVersion: GLSL3,
      vertexShader: fullscreenVertexShader,
      fragmentShader: copyFragmentShader,
      uniforms: {
        uTexture: { value: null },
      },
    });

    this.velocityMaterial = new RawShaderMaterial({
      glslVersion: GLSL3,
      vertexShader: fullscreenVertexShader,
      fragmentShader: simulateVelocityFragmentShader,
      uniforms: {
        uPositionTexture: { value: null },
        uVelocityTexture: { value: null },
        uAnchorTexture: { value: null },
        uBoundaryTexture: { value: null },
        uMetaTexture: { value: null },
        uDelta: { value: 0.016 },
        uTime: { value: 0 },
        uAttractionStrength: { value: 1 },
        uFlowStrength: { value: 1 },
        uErosionStrength: { value: 1 },
        uEdgeThreshold: { value: 0.35 },
        uEdgeBoost: { value: 1 },
        uDamping: { value: 0.2 },
        uDepthThickness: { value: 0.2 },
        uMotionSpeed: { value: 1 },
      },
    });

    this.positionMaterial = new RawShaderMaterial({
      glslVersion: GLSL3,
      vertexShader: fullscreenVertexShader,
      fragmentShader: integratePositionFragmentShader,
      uniforms: {
        uPositionTexture: { value: null },
        uVelocityTexture: { value: null },
        uDelta: { value: 0.016 },
      },
    });

    this.quad = new Mesh(geometry, this.copyMaterial);
    this.scene.add(this.quad);

    this.positionTargets = [createRenderTarget(resolution), createRenderTarget(resolution)];
    this.velocityTargets = [createRenderTarget(resolution), createRenderTarget(resolution)];
  }

  private render(material: RawShaderMaterial, target: WebGLRenderTarget): void {
    this.quad.material = material;
    this.renderer.setRenderTarget(target);
    this.renderer.render(this.scene, this.camera);
    this.renderer.setRenderTarget(null);
  }

  private copyTexture(source: ProcessedParticleImage['anchorTexture'], target: WebGLRenderTarget): void {
    this.copyMaterial.uniforms.uTexture.value = source;
    this.render(this.copyMaterial, target);
  }

  initialize(data: ProcessedParticleImage): void {
    this.copyTexture(data.initialPositionTexture, this.positionTargets[0]);
    this.copyTexture(data.initialPositionTexture, this.positionTargets[1]);
    this.copyTexture(data.initialVelocityTexture, this.velocityTargets[0]);
    this.copyTexture(data.initialVelocityTexture, this.velocityTargets[1]);

    this.velocityMaterial.uniforms.uAnchorTexture.value = data.anchorTexture;
    this.velocityMaterial.uniforms.uBoundaryTexture.value = data.boundaryTexture;
    this.velocityMaterial.uniforms.uMetaTexture.value = data.metaTexture;
  }

  update(delta: number, elapsedTime: number, tuning: ParticleTuning): void {
    const current = this.currentIndex;
    const next = 1 - current;
    const positionTexture = this.positionTargets[current].texture;
    const velocityTexture = this.velocityTargets[current].texture;

    this.velocityMaterial.uniforms.uPositionTexture.value = positionTexture;
    this.velocityMaterial.uniforms.uVelocityTexture.value = velocityTexture;
    this.velocityMaterial.uniforms.uDelta.value = delta;
    this.velocityMaterial.uniforms.uTime.value = elapsedTime;
    this.velocityMaterial.uniforms.uAttractionStrength.value = tuning.attractionStrength;
    this.velocityMaterial.uniforms.uFlowStrength.value = tuning.flowStrength;
    this.velocityMaterial.uniforms.uErosionStrength.value = tuning.erosionStrength;
    this.velocityMaterial.uniforms.uEdgeThreshold.value = tuning.edgeThreshold;
    this.velocityMaterial.uniforms.uEdgeBoost.value = tuning.edgeBoost;
    this.velocityMaterial.uniforms.uDamping.value = tuning.damping;
    this.velocityMaterial.uniforms.uDepthThickness.value = tuning.depthThickness;
    this.velocityMaterial.uniforms.uMotionSpeed.value = tuning.motionSpeed;
    this.render(this.velocityMaterial, this.velocityTargets[next]);

    this.positionMaterial.uniforms.uPositionTexture.value = positionTexture;
    this.positionMaterial.uniforms.uVelocityTexture.value = this.velocityTargets[next].texture;
    this.positionMaterial.uniforms.uDelta.value = delta;
    this.render(this.positionMaterial, this.positionTargets[next]);

    this.currentIndex = next;
  }

  get positionTexture() {
    return this.positionTargets[this.currentIndex].texture;
  }

  dispose(): void {
    (this.quad.geometry as PlaneGeometry).dispose();
    this.copyMaterial.dispose();
    this.velocityMaterial.dispose();
    this.positionMaterial.dispose();
    disposeRenderTarget(this.positionTargets[0]);
    disposeRenderTarget(this.positionTargets[1]);
    disposeRenderTarget(this.velocityTargets[0]);
    disposeRenderTarget(this.velocityTargets[1]);
  }
}
