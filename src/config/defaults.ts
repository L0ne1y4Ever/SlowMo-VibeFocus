export interface ParticleTuning {
  particleCount: number;
  particleSize: number;
  contrast: number;
  colorTint: number;
  alphaGain: number;
  flowSpeed: number;
  flowAmplitude: number;
  edgeLooseness: number;
  depthStrength: number;
  mouseRadius: number;
  mouseStrength: number;
  bloomStrength: number;
  bloomRadius: number;
  bloomThreshold: number;
  chromaticAberration: number;
  backgroundIntensity: number;
}

export const DEFAULT_TUNING: ParticleTuning = {
  particleCount: 350_000,
  particleSize: 2.0,
  contrast: 1.5,
  colorTint: 0.55,
  alphaGain: 1.0,
  flowSpeed: 0.12,
  flowAmplitude: 0.008,
  edgeLooseness: 0.8,
  depthStrength: 0.3,
  mouseRadius: 0.08,
  mouseStrength: 0.3,
  bloomStrength: 0.25,
  bloomRadius: 0.3,
  bloomThreshold: 0.92,
  chromaticAberration: 0.8,
  backgroundIntensity: 0.0,
};

export interface RenderConstants {
  clearColor: number;
  cameraFov: number;
  cameraDistance: number;
  mouseFieldResolution: number;
}

export const RENDER_CONSTANTS: RenderConstants = {
  clearColor: 0x000000,
  cameraFov: 50,
  cameraDistance: 1.8,
  mouseFieldResolution: 256,
};

export function quantizeParticleCount(requested: number): { count: number; gridX: number; gridY: number } {
  const clamped = Math.max(256, Math.min(1_048_576, Math.round(requested)));
  const side = Math.ceil(Math.sqrt(clamped));
  return { count: side * side, gridX: side, gridY: side };
}
