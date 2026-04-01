const GOLDEN_RATIO = 1.618033988749895;
const SILVER_RATIO = 1.324717957244746;

export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export function lerp(start: number, end: number, t: number): number {
  return start + (end - start) * t;
}

export function damp(current: number, target: number, smoothing: number, delta: number): number {
  return lerp(current, target, 1 - Math.exp(-smoothing * delta));
}

export function fract(value: number): number {
  return value - Math.floor(value);
}

export function r2Sequence(index: number): [number, number] {
  return [
    fract(0.5 + index / GOLDEN_RATIO),
    fract(0.5 + index / (GOLDEN_RATIO * SILVER_RATIO)),
  ];
}

export function hash11(value: number): number {
  const x = Math.sin(value * 127.1 + 311.7) * 43758.5453123;
  return fract(x);
}

export function hash21(x: number, y: number): number {
  const value = Math.sin(x * 127.1 + y * 311.7) * 43758.5453123;
  return fract(value);
}

export function srgbToLinear(value: number): number {
  if (value <= 0.04045) {
    return value / 12.92;
  }

  return Math.pow((value + 0.055) / 1.055, 2.4);
}
