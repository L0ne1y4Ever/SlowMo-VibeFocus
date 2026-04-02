import {
  ClampToEdgeWrapping,
  DataTexture,
  FloatType,
  LinearFilter,
  RGBAFormat,
} from 'three';
import { clamp } from '../utils/math';

export interface ProcessedImage {
  readonly maskTexture: DataTexture;
  readonly analysisWidth: number;
  readonly analysisHeight: number;
  dispose(): void;
}

const ANALYSIS_MAX = 512;

export function analyzeImage(source: HTMLCanvasElement): ProcessedImage {
  const aspectRatio = source.width / source.height;
  let aW: number, aH: number;
  if (aspectRatio >= 1) {
    aW = ANALYSIS_MAX;
    aH = Math.round(ANALYSIS_MAX / aspectRatio);
  } else {
    aH = ANALYSIS_MAX;
    aW = Math.round(ANALYSIS_MAX * aspectRatio);
  }

  const canvas = document.createElement('canvas');
  canvas.width = aW;
  canvas.height = aH;
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
  ctx.drawImage(source, 0, 0, aW, aH);
  const { data } = ctx.getImageData(0, 0, aW, aH);
  const total = aW * aH;

  // 1. Luminance
  const luminance = new Float32Array(total);
  for (let i = 0; i < total; i++) {
    const off = i * 4;
    luminance[i] = data[off] / 255 * 0.2126 + data[off + 1] / 255 * 0.7152 + data[off + 2] / 255 * 0.0722;
  }

  // 2. Silhouette
  const silhouette = new Float32Array(total);
  for (let i = 0; i < total; i++) {
    silhouette[i] = luminance[i] > 0.02 ? 1.0 : 0.0;
  }

  // 3. Sobel edge detection
  const edge = new Float32Array(total);
  const lum = (x: number, y: number): number => {
    return luminance[clamp(y, 0, aH - 1) * aW + clamp(x, 0, aW - 1)];
  };
  let maxEdge = 0;
  for (let y = 0; y < aH; y++) {
    for (let x = 0; x < aW; x++) {
      const gx =
        -lum(x - 1, y - 1) - 2 * lum(x - 1, y) - lum(x - 1, y + 1) +
         lum(x + 1, y - 1) + 2 * lum(x + 1, y) + lum(x + 1, y + 1);
      const gy =
        -lum(x - 1, y - 1) - 2 * lum(x, y - 1) - lum(x + 1, y - 1) +
         lum(x - 1, y + 1) + 2 * lum(x, y + 1) + lum(x + 1, y + 1);
      const mag = Math.sqrt(gx * gx + gy * gy);
      edge[y * aW + x] = mag;
      if (mag > maxEdge) maxEdge = mag;
    }
  }
  if (maxEdge > 0) for (let i = 0; i < total; i++) edge[i] = clamp(edge[i] / maxEdge, 0, 1);

  // 4. Distance-to-edge (chamfer)
  const dist = new Float32Array(total);
  const INF = aW + aH;
  for (let y = 0; y < aH; y++) {
    for (let x = 0; x < aW; x++) {
      const i = y * aW + x;
      if (silhouette[i] < 0.5) { dist[i] = 0; continue; }
      let atEdge = false;
      if (x > 0 && silhouette[i - 1] < 0.5) atEdge = true;
      if (x < aW - 1 && silhouette[i + 1] < 0.5) atEdge = true;
      if (y > 0 && silhouette[i - aW] < 0.5) atEdge = true;
      if (y < aH - 1 && silhouette[i + aW] < 0.5) atEdge = true;
      dist[i] = atEdge ? 0 : INF;
    }
  }
  for (let y = 0; y < aH; y++)
    for (let x = 0; x < aW; x++) {
      const i = y * aW + x;
      if (x > 0) dist[i] = Math.min(dist[i], dist[i - 1] + 1);
      if (y > 0) dist[i] = Math.min(dist[i], dist[i - aW] + 1);
    }
  for (let y = aH - 1; y >= 0; y--)
    for (let x = aW - 1; x >= 0; x--) {
      const i = y * aW + x;
      if (x < aW - 1) dist[i] = Math.min(dist[i], dist[i + 1] + 1);
      if (y < aH - 1) dist[i] = Math.min(dist[i], dist[i + aW] + 1);
    }
  let maxDist = 0;
  for (let i = 0; i < total; i++) if (dist[i] > maxDist && dist[i] < INF) maxDist = dist[i];
  if (maxDist > 0) for (let i = 0; i < total; i++) dist[i] = clamp(dist[i] / maxDist, 0, 1);

  // 5. Pack RGBA: luminance, edge, distToEdge, silhouette
  const maskData = new Float32Array(total * 4);
  for (let i = 0; i < total; i++) {
    maskData[i * 4] = luminance[i];
    maskData[i * 4 + 1] = edge[i];
    maskData[i * 4 + 2] = dist[i];
    maskData[i * 4 + 3] = silhouette[i];
  }

  const maskTexture = new DataTexture(maskData, aW, aH, RGBAFormat, FloatType);
  maskTexture.minFilter = LinearFilter;
  maskTexture.magFilter = LinearFilter;
  maskTexture.wrapS = ClampToEdgeWrapping;
  maskTexture.wrapT = ClampToEdgeWrapping;
  maskTexture.flipY = false;
  maskTexture.needsUpdate = true;

  return {
    maskTexture,
    analysisWidth: aW,
    analysisHeight: aH,
    dispose() { maskTexture.dispose(); },
  };
}
