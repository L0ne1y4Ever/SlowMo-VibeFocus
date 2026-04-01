export interface ParticleTuning {
  particleCount: number;
  particleSize: number;
  attractionStrength: number;
  flowStrength: number;
  erosionStrength: number;
  edgeThreshold: number;
  edgeBoost: number;
  damping: number;
  depthThickness: number;
  motionSpeed: number;
  densityCompensation: number;
  brightness: number;
  alphaGain: number;
  backgroundIntensity: number;
  parallaxAmount: number;
}

export const DEFAULT_PARTICLE_COUNT = 1_048_576;

export const DEFAULT_TUNING: ParticleTuning = {
  particleCount: DEFAULT_PARTICLE_COUNT,
  particleSize: 1.9,
  attractionStrength: 1.88,
  flowStrength: 0.28,
  erosionStrength: 1.26,
  edgeThreshold: 0.46,
  edgeBoost: 1.48,
  damping: 0.19,
  depthThickness: 0.18,
  motionSpeed: 0.84,
  densityCompensation: 1.98,
  brightness: 1.02,
  alphaGain: 1.82,
  backgroundIntensity: 0.66,
  parallaxAmount: 0.22,
};

export interface RenderConstants {
  clearColor: number;
  cameraFov: number;
  cameraDistance: number;
  longestImageSide: number;
  analysisMaxDimension: number;
}

export const RENDER_CONSTANTS: RenderConstants = {
  clearColor: 0x040507,
  cameraFov: 30,
  cameraDistance: 3.35,
  longestImageSide: 1.34,
  analysisMaxDimension: 512,
};

export function quantizeParticleCount(requestedCount: number): { count: number; resolution: number } {
  const clamped = Math.max(65_536, Math.min(1_048_576, Math.round(requestedCount)));
  const resolution = Math.ceil(Math.sqrt(clamped));
  return {
    count: resolution * resolution,
    resolution,
  };
}

export function densityScale(count: number, compensation: number): number {
  return Math.sqrt(DEFAULT_PARTICLE_COUNT / count) * compensation;
}
