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
  particleSize: 1.34,
  contrast: 1.22,
  colorTint: 0.86,
  alphaGain: 1.16,
  flowSpeed: 0.12,
  flowAmplitude: 0.011,
  edgeLooseness: 0.82,
  depthStrength: 0.18,
  mouseRadius: 0.08,
  mouseStrength: 0.28,
  bloomStrength: 0.16,
  bloomRadius: 0.22,
  bloomThreshold: 0.96,
  chromaticAberration: 0.35,
  backgroundIntensity: 0.0,
};

export interface RenderConstants {
  clearColor: number;
  cameraFov: number;
  cameraDistance: number;
  mouseFieldResolution: number;
  baseAccumulationScale: number;
}

export const RENDER_CONSTANTS: RenderConstants = {
  clearColor: 0x000000,
  cameraFov: 50,
  cameraDistance: 1.8,
  mouseFieldResolution: 256,
  baseAccumulationScale: 0.67,
};

export function quantizeParticleCount(requested: number): { count: number; gridX: number; gridY: number } {
  const clamped = Math.max(256, Math.min(1_048_576, Math.round(requested)));
  const side = Math.ceil(Math.sqrt(clamped));
  return { count: side * side, gridX: side, gridY: side };
}
