import {
  ClampToEdgeWrapping,
  DataTexture,
  FloatType,
  LinearFilter,
  RGBAFormat,
} from 'three';
import { clamp, srgbToLinear } from '../utils/math';

export interface ProcessedImage {
  readonly analysisTexture: DataTexture;
  readonly analysisWidth: number;
  readonly analysisHeight: number;
  readonly occupancyData: Float32Array;
  readonly contentWeightData: Float32Array;
  readonly edgeData: Float32Array;
  readonly distanceData: Float32Array;
  readonly highlightData: Float32Array;
  readonly edgeBandWeightData: Float32Array;
  readonly peelEligibilityData: Float32Array;
  readonly contentBounds: ContentBounds;
  readonly contentCenter: ContentCenter;
  readonly contentFrame: ContentFrame;
  readonly matteMode: MatteMode;
  dispose(): void;
}

export interface ContentBounds {
  readonly minU: number;
  readonly maxU: number;
  readonly minV: number;
  readonly maxV: number;
}

export interface ContentCenter {
  readonly u: number;
  readonly v: number;
}

export interface ContentFrame {
  readonly centerU: number;
  readonly centerV: number;
  readonly heightUV: number;
  readonly imageAspect: number;
  readonly worldAspect: number;
}

export type MatteMode = 'alpha' | 'generic' | 'generic+portraitHint';

const ANALYSIS_MAX = 512;

function smoothstep(edge0: number, edge1: number, value: number): number {
  if (edge0 === edge1) {
    return value < edge0 ? 0 : 1;
  }

  const t = clamp((value - edge0) / (edge1 - edge0), 0, 1);
  return t * t * (3 - 2 * t);
}

function luminanceOf(rgb: readonly [number, number, number]): number {
  return rgb[0] * 0.2126 + rgb[1] * 0.7152 + rgb[2] * 0.0722;
}

function getPixelIndex(x: number, y: number, width: number, height: number): number {
  const px = clamp(x, 0, width - 1);
  const py = clamp(y, 0, height - 1);
  return py * width + px;
}

function maxFilter(source: Float32Array, width: number, height: number): Float32Array {
  const filtered = new Float32Array(source.length);

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      let maxValue = 0;
      for (let oy = -1; oy <= 1; oy++) {
        for (let ox = -1; ox <= 1; ox++) {
          maxValue = Math.max(maxValue, source[getPixelIndex(x + ox, y + oy, width, height)]);
        }
      }
      filtered[y * width + x] = maxValue;
    }
  }

  return filtered;
}

function minFilter(source: Float32Array, width: number, height: number): Float32Array {
  const filtered = new Float32Array(source.length);

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      let minValue = 1;
      for (let oy = -1; oy <= 1; oy++) {
        for (let ox = -1; ox <= 1; ox++) {
          minValue = Math.min(minValue, source[getPixelIndex(x + ox, y + oy, width, height)]);
        }
      }
      filtered[y * width + x] = minValue;
    }
  }

  return filtered;
}

function boxBlur(source: Float32Array, width: number, height: number): Float32Array {
  const blurred = new Float32Array(source.length);

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      let sum = 0;
      let count = 0;
      for (let oy = -1; oy <= 1; oy++) {
        for (let ox = -1; ox <= 1; ox++) {
          sum += source[getPixelIndex(x + ox, y + oy, width, height)];
          count++;
        }
      }
      blurred[y * width + x] = sum / count;
    }
  }

  return blurred;
}

function estimateBorderColor(
  linearRgb: Float32Array,
  alpha: Float32Array,
  width: number,
  height: number,
): [number, number, number] {
  const border = Math.max(2, Math.round(Math.min(width, height) * 0.04));
  let sumR = 0;
  let sumG = 0;
  let sumB = 0;
  let totalWeight = 0;

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (x >= border && x < width - border && y >= border && y < height - border) {
        continue;
      }

      const i = y * width + x;
      const rgbOff = i * 3;
      const weight = Math.max(alpha[i], 0.1);
      sumR += linearRgb[rgbOff] * weight;
      sumG += linearRgb[rgbOff + 1] * weight;
      sumB += linearRgb[rgbOff + 2] * weight;
      totalWeight += weight;
    }
  }

  if (totalWeight <= 0) {
    return [0, 0, 0];
  }

  return [sumR / totalWeight, sumG / totalWeight, sumB / totalWeight];
}

function floodFillBackground(
  width: number,
  height: number,
  canVisit: (index: number) => boolean,
): Uint8Array {
  const visited = new Uint8Array(width * height);
  const queue = new Int32Array(width * height);
  let head = 0;
  let tail = 0;

  const enqueue = (index: number): void => {
    if (visited[index] !== 0 || !canVisit(index)) {
      return;
    }
    visited[index] = 1;
    queue[tail++] = index;
  };

  for (let x = 0; x < width; x++) {
    enqueue(x);
    enqueue((height - 1) * width + x);
  }
  for (let y = 1; y < height - 1; y++) {
    enqueue(y * width);
    enqueue(y * width + (width - 1));
  }

  while (head < tail) {
    const index = queue[head++];
    const x = index % width;
    const y = Math.floor(index / width);

    for (let oy = -1; oy <= 1; oy++) {
      for (let ox = -1; ox <= 1; ox++) {
        if (ox === 0 && oy === 0) {
          continue;
        }

        const nx = x + ox;
        const ny = y + oy;
        if (nx < 0 || nx >= width || ny < 0 || ny >= height) {
          continue;
        }

        const neighbor = ny * width + nx;
        if (visited[neighbor] === 0 && canVisit(neighbor)) {
          visited[neighbor] = 1;
          queue[tail++] = neighbor;
        }
      }
    }
  }

  return visited;
}

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

  const linearRgb = new Float32Array(total * 3);
  const alpha = new Float32Array(total);
  const luminance = new Float32Array(total);
  for (let i = 0; i < total; i++) {
    const off = i * 4;
    const r = srgbToLinear(data[off] / 255);
    const g = srgbToLinear(data[off + 1] / 255);
    const b = srgbToLinear(data[off + 2] / 255);
    const rgbOff = i * 3;
    linearRgb[rgbOff] = r;
    linearRgb[rgbOff + 1] = g;
    linearRgb[rgbOff + 2] = b;
    alpha[i] = data[off + 3] / 255;
    luminance[i] = r * 0.2126 + g * 0.7152 + b * 0.0722;
  }

  const hasMeaningfulAlpha = alpha.some((value) => value < 0.995);
  const matteMode: MatteMode = hasMeaningfulAlpha ? 'alpha' : 'generic';
  const backgroundColor = estimateBorderColor(linearRgb, alpha, aW, aH);
  const backgroundLuminance = luminanceOf(backgroundColor);
  const colorDistance = new Float32Array(total);
  const luminanceDistance = new Float32Array(total);

  // 1. Sobel edge detection + local contrast
  const edge = new Float32Array(total);
  const localContrast = new Float32Array(total);
  const lum = (x: number, y: number): number => {
    return luminance[clamp(y, 0, aH - 1) * aW + clamp(x, 0, aW - 1)];
  };
  let maxEdge = 0;
  let maxContrast = 0;
  for (let y = 0; y < aH; y++) {
    for (let x = 0; x < aW; x++) {
      const gx =
        -lum(x - 1, y - 1) - 2 * lum(x - 1, y) - lum(x - 1, y + 1) +
         lum(x + 1, y - 1) + 2 * lum(x + 1, y) + lum(x + 1, y + 1);
      const gy =
        -lum(x - 1, y - 1) - 2 * lum(x, y - 1) - lum(x + 1, y - 1) +
         lum(x - 1, y + 1) + 2 * lum(x, y + 1) + lum(x + 1, y + 1);
      const mag = Math.sqrt(gx * gx + gy * gy);
      const index = y * aW + x;
      edge[index] = mag;
      if (mag > maxEdge) maxEdge = mag;

      const center = lum(x, y);
      const contrast = (
        Math.abs(center - lum(x - 1, y)) +
        Math.abs(center - lum(x + 1, y)) +
        Math.abs(center - lum(x, y - 1)) +
        Math.abs(center - lum(x, y + 1))
      ) * 0.25;
      localContrast[index] = contrast;
      if (contrast > maxContrast) maxContrast = contrast;
    }
  }
  if (maxEdge > 0) for (let i = 0; i < total; i++) edge[i] = clamp(edge[i] / maxEdge, 0, 1);
  if (maxContrast > 0) {
    for (let i = 0; i < total; i++) {
      localContrast[i] = clamp(localContrast[i] / maxContrast, 0, 1);
    }
  }

  // 2. Occupancy-first mask
  const occupancySeed = new Float32Array(total);
  for (let i = 0; i < total; i++) {
    const rgbOff = i * 3;
    const dr = linearRgb[rgbOff] - backgroundColor[0];
    const dg = linearRgb[rgbOff + 1] - backgroundColor[1];
    const db = linearRgb[rgbOff + 2] - backgroundColor[2];
    colorDistance[i] = Math.sqrt(dr * dr + dg * dg + db * db) / Math.sqrt(3);
    luminanceDistance[i] = Math.abs(luminance[i] - backgroundLuminance);

    if (hasMeaningfulAlpha) {
      occupancySeed[i] = clamp(alpha[i], 0, 1);
      continue;
    }

    const colorTerm = smoothstep(0.022, 0.16, colorDistance[i]);
    const luminanceTerm = smoothstep(0.015, 0.14, luminanceDistance[i]);
    const contrastTerm = smoothstep(0.045, 0.24, localContrast[i]);
    const edgeTerm = smoothstep(0.08, 0.28, edge[i]);
    const combined = Math.max(
      colorTerm,
      luminanceTerm * 0.88,
      contrastTerm * 0.82,
      edgeTerm * 0.5,
    );
    occupancySeed[i] = clamp(combined, 0, 1);
  }

  const backgroundVisited = hasMeaningfulAlpha
    ? new Uint8Array(total)
    : floodFillBackground(aW, aH, (index) => {
        const backgroundSimilarity = smoothstep(0.0, 0.08, 0.1 - colorDistance[index]);
        const lowForeground = smoothstep(0.12, 0.32, 0.34 - occupancySeed[index]);
        const softEdge = 1.0 - smoothstep(0.12, 0.42, edge[index] + localContrast[index] * 0.6);
        const matteBackgroundScore = Math.max(
          backgroundSimilarity * 0.92,
          lowForeground * softEdge,
          smoothstep(0.0, 0.05, 0.06 - luminanceDistance[index]) * 0.72,
        );
        return matteBackgroundScore > 0.34;
      });

  const occupancyAfterBackground = new Float32Array(total);
  for (let i = 0; i < total; i++) {
    occupancyAfterBackground[i] = hasMeaningfulAlpha
      ? occupancySeed[i]
      : clamp(occupancySeed[i] - backgroundVisited[i] * 0.82, 0, 1);
  }

  const expandedOccupancy = maxFilter(occupancyAfterBackground, aW, aH);
  const closedOccupancy = minFilter(expandedOccupancy, aW, aH);
  const blurredOccupancy = boxBlur(closedOccupancy, aW, aH);
  const occupancy = new Float32Array(total);
  const silhouette = new Float32Array(total);
  const silhouetteThreshold = hasMeaningfulAlpha ? 0.04 : 0.14;
  for (let i = 0; i < total; i++) {
    const coverage = hasMeaningfulAlpha
      ? clamp(Math.max(alpha[i], blurredOccupancy[i]), 0, 1)
      : clamp(Math.max(occupancyAfterBackground[i], blurredOccupancy[i] * 1.06 - 0.03), 0, 1);
    occupancy[i] = coverage;
    silhouette[i] = coverage >= silhouetteThreshold ? 1.0 : 0.0;
  }

  // 3. Distance-to-edge (inside silhouette)
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

  // 4. Highlight + narrow edge band weights
  const highlight = new Float32Array(total);
  const contentWeight = new Float32Array(total);
  const edgeBandWeights = new Float32Array(total);
  const peelEligibility = new Float32Array(total);
  const contentSupport = new Float32Array(total);
  for (let i = 0; i < total; i++) {
    const highlightMask = smoothstep(0.58, 0.9, luminance[i]) * (0.7 + edge[i] * 0.3);
    const narrowContourBand = 1.0 - smoothstep(0.03, 0.15, dist[i]);
    const structureSupport = clamp(
      edge[i] * 0.55 +
      localContrast[i] * 0.65 +
      colorDistance[i] * 0.3 +
      highlightMask * 0.15,
      0,
      1,
    );
    const contentSupportValue = occupancy[i] * (0.44 + (1.0 - 0.44) * structureSupport);
    const centerBias = 0.78 + dist[i] * 0.52;
    const structuralBias = 0.86 + localContrast[i] * 0.18 + highlightMask * 0.08;
    contentWeight[i] = clamp(contentSupportValue * centerBias * structuralBias, 0, 1.75);
    const bandWeight = occupancy[i] * narrowContourBand * smoothstep(0.05, 0.24, edge[i] + highlightMask * 0.18);
    const stressedRegion = smoothstep(
      0.18,
      0.56,
      edge[i] * 0.74 + localContrast[i] * 0.68 + highlightMask * 0.24,
    ) * (1.0 - smoothstep(0.42, 0.88, dist[i]));
    highlight[i] = clamp(highlightMask, 0, 1);
    contentSupport[i] = clamp(contentSupportValue, 0, 1);
    edgeBandWeights[i] = clamp(bandWeight, 0, 1);
    peelEligibility[i] = clamp(
      occupancy[i] * Math.max(narrowContourBand * 0.92, stressedRegion * 0.68),
      0,
      1,
    );
  }

  let minX = aW - 1;
  let maxX = 0;
  let minY = aH - 1;
  let maxY = 0;
  let foundContent = false;
  for (let y = 0; y < aH; y++) {
    for (let x = 0; x < aW; x++) {
      const index = y * aW + x;
      if (contentSupport[index] < 0.16 && occupancy[index] < 0.26) {
        continue;
      }
      foundContent = true;
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
  }

  if (!foundContent) {
    minX = 0;
    maxX = aW - 1;
    minY = 0;
    maxY = aH - 1;
  }

  const padX = Math.max(2, Math.round((maxX - minX + 1) * 0.04));
  const padY = Math.max(2, Math.round((maxY - minY + 1) * 0.04));
  minX = clamp(minX - padX, 0, aW - 1);
  maxX = clamp(maxX + padX, 0, aW - 1);
  minY = clamp(minY - padY, 0, aH - 1);
  maxY = clamp(maxY + padY, 0, aH - 1);

  const minU = minX / aW;
  const maxU = (maxX + 1) / aW;
  const minV = minY / aH;
  const maxV = (maxY + 1) / aH;
  const contentBounds: ContentBounds = { minU, maxU, minV, maxV };
  const contentCenter: ContentCenter = {
    u: (minU + maxU) * 0.5,
    v: (minV + maxV) * 0.5,
  };
  const contentHeightUV = Math.max(maxV - minV, 0.18);
  const contentWidthUV = Math.max(maxU - minU, 0.18);
  const contentFrame: ContentFrame = {
    centerU: contentCenter.u,
    centerV: contentCenter.v,
    heightUV: contentHeightUV,
    imageAspect: aspectRatio,
    worldAspect: aspectRatio * (contentWidthUV / contentHeightUV),
  };

  // 5. Pack RGBA: occupancy, edge, distance-to-edge, highlight
  const packedData = new Float32Array(total * 4);
  for (let i = 0; i < total; i++) {
    packedData[i * 4] = occupancy[i];
    packedData[i * 4 + 1] = edge[i];
    packedData[i * 4 + 2] = dist[i];
    packedData[i * 4 + 3] = highlight[i];
  }

  const analysisTexture = new DataTexture(packedData, aW, aH, RGBAFormat, FloatType);
  analysisTexture.minFilter = LinearFilter;
  analysisTexture.magFilter = LinearFilter;
  analysisTexture.wrapS = ClampToEdgeWrapping;
  analysisTexture.wrapT = ClampToEdgeWrapping;
  analysisTexture.flipY = false;
  analysisTexture.needsUpdate = true;

  return {
    analysisTexture,
    analysisWidth: aW,
    analysisHeight: aH,
    occupancyData: occupancy,
    contentWeightData: contentWeight,
    edgeData: edge,
    distanceData: dist,
    highlightData: highlight,
    edgeBandWeightData: edgeBandWeights,
    peelEligibilityData: peelEligibility,
    contentBounds,
    contentCenter,
    contentFrame,
    matteMode,
    dispose() { analysisTexture.dispose(); },
  };
}
