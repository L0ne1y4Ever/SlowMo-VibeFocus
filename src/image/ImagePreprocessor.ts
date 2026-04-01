import {
  ClampToEdgeWrapping,
  DataTexture,
  FloatType,
  NearestFilter,
  RGBAFormat,
} from 'three';
import { RENDER_CONSTANTS } from '../config/defaults';
import { clamp, hash11, lerp, r2Sequence, srgbToLinear } from '../utils/math';

interface PixelAnalysis {
  width: number;
  height: number;
  color: Uint8ClampedArray;
  luminance: Float32Array;
  coverage: Float32Array;
  gradient: Float32Array;
  interior: Float32Array;
  edgeWeight: Float32Array;
  coreWeight: Float32Array;
  shellDepth: Float32Array;
  boundaryNormalX: Float32Array;
  boundaryNormalY: Float32Array;
  shellCoord: Float32Array;
  importance: Float32Array;
  cropMinX: number;
  cropMinY: number;
  cropWidth: number;
  cropHeight: number;
}

export interface ProcessedParticleImage {
  readonly resolution: number;
  readonly particleCount: number;
  readonly worldWidth: number;
  readonly worldHeight: number;
  readonly anchorTexture: DataTexture;
  readonly boundaryTexture: DataTexture;
  readonly colorTexture: DataTexture;
  readonly metaTexture: DataTexture;
  readonly initialPositionTexture: DataTexture;
  readonly initialVelocityTexture: DataTexture;
  dispose(): void;
}

interface BorderStats {
  r: number;
  g: number;
  b: number;
  luma: number;
  variance: number;
}

interface ContentBounds {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
  centroidX: number;
  centroidY: number;
}

function smoothstep(min: number, max: number, value: number): number {
  if (min === max) {
    return value < min ? 0 : 1;
  }

  const t = clamp((value - min) / (max - min), 0, 1);
  return t * t * (3 - 2 * t);
}

function getSourceDimensions(source: CanvasImageSource): { width: number; height: number } {
  if (source instanceof HTMLVideoElement) {
    return { width: source.videoWidth, height: source.videoHeight };
  }

  if (source instanceof HTMLImageElement) {
    return { width: source.naturalWidth, height: source.naturalHeight };
  }

  if (source instanceof HTMLCanvasElement) {
    return { width: source.width, height: source.height };
  }

  if (typeof ImageBitmap !== 'undefined' && source instanceof ImageBitmap) {
    return { width: source.width, height: source.height };
  }

  if (typeof OffscreenCanvas !== 'undefined' && source instanceof OffscreenCanvas) {
    return { width: source.width, height: source.height };
  }

  if (source instanceof SVGImageElement) {
    return {
      width: source.width.baseVal.value,
      height: source.height.baseVal.value,
    };
  }

  throw new Error('Unsupported image source.');
}

function createAnalysisCanvas(source: CanvasImageSource): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  const { width, height } = getSourceDimensions(source);
  const aspect = width / height;
  const maxDimension = RENDER_CONSTANTS.analysisMaxDimension;

  if (aspect >= 1) {
    canvas.width = maxDimension;
    canvas.height = Math.max(2, Math.round(maxDimension / aspect));
  } else {
    canvas.height = maxDimension;
    canvas.width = Math.max(2, Math.round(maxDimension * aspect));
  }

  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) {
    throw new Error('Unable to create preprocessing canvas.');
  }

  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(source, 0, 0, canvas.width, canvas.height);
  return canvas;
}

function computeBorderStats(data: Uint8ClampedArray, width: number, height: number): BorderStats {
  let sumR = 0;
  let sumG = 0;
  let sumB = 0;
  let sumLuma = 0;
  let count = 0;

  const readPixel = (x: number, y: number): [number, number, number] => {
    const index = (y * width + x) * 4;
    return [
      data[index] / 255,
      data[index + 1] / 255,
      data[index + 2] / 255,
    ];
  };

  for (let x = 0; x < width; x += 1) {
    const [tr, tg, tb] = readPixel(x, 0);
    const [br, bg, bb] = readPixel(x, height - 1);
    sumR += tr + br;
    sumG += tg + bg;
    sumB += tb + bb;
    sumLuma += tr * 0.2126 + tg * 0.7152 + tb * 0.0722;
    sumLuma += br * 0.2126 + bg * 0.7152 + bb * 0.0722;
    count += 2;
  }

  for (let y = 1; y < height - 1; y += 1) {
    const [lr, lg, lb] = readPixel(0, y);
    const [rr, rg, rb] = readPixel(width - 1, y);
    sumR += lr + rr;
    sumG += lg + rg;
    sumB += lb + rb;
    sumLuma += lr * 0.2126 + lg * 0.7152 + lb * 0.0722;
    sumLuma += rr * 0.2126 + rg * 0.7152 + rb * 0.0722;
    count += 2;
  }

  const meanR = sumR / count;
  const meanG = sumG / count;
  const meanB = sumB / count;
  const meanLuma = sumLuma / count;

  let variance = 0;
  for (let x = 0; x < width; x += 1) {
    for (const y of [0, height - 1]) {
      const index = (y * width + x) * 4;
      const dr = data[index] / 255 - meanR;
      const dg = data[index + 1] / 255 - meanG;
      const db = data[index + 2] / 255 - meanB;
      variance += dr * dr + dg * dg + db * db;
    }
  }

  for (let y = 1; y < height - 1; y += 1) {
    for (const x of [0, width - 1]) {
      const index = (y * width + x) * 4;
      const dr = data[index] / 255 - meanR;
      const dg = data[index + 1] / 255 - meanG;
      const db = data[index + 2] / 255 - meanB;
      variance += dr * dr + dg * dg + db * db;
    }
  }

  return {
    r: meanR,
    g: meanG,
    b: meanB,
    luma: meanLuma,
    variance: Math.sqrt(variance / count),
  };
}

function blurField(source: Float32Array, width: number, height: number, radius: number): Float32Array {
  const target = new Float32Array(source.length);

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      let sum = 0;
      let weight = 0;

      for (let oy = -radius; oy <= radius; oy += 1) {
        const sy = clamp(y + oy, 0, height - 1);
        for (let ox = -radius; ox <= radius; ox += 1) {
          const sx = clamp(x + ox, 0, width - 1);
          sum += source[sy * width + sx];
          weight += 1;
        }
      }

      target[y * width + x] = sum / weight;
    }
  }

  return target;
}

function deriveForegroundMask(
  data: Uint8ClampedArray,
  width: number,
  height: number,
  borderStats: BorderStats,
  luminance: Float32Array,
): Float32Array {
  const total = width * height;
  const affinity = new Float32Array(total);
  const backgroundMask = new Uint8Array(total);
  const queue = new Int32Array(total);
  let head = 0;
  let tail = 0;

  const seedThreshold = 0.082 + borderStats.variance * 1.5;
  const growThreshold = seedThreshold * 1.55 + 0.036;
  const neighborThreshold = 0.12 + borderStats.variance * 0.7;

  const enqueue = (index: number): void => {
    if (backgroundMask[index]) {
      return;
    }

    backgroundMask[index] = 1;
    queue[tail] = index;
    tail += 1;
  };

  const isBorderPixel = (x: number, y: number): boolean => x === 0 || y === 0 || x === width - 1 || y === height - 1;

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const index = y * width + x;
      const offset = index * 4;
      const r = data[offset] / 255;
      const g = data[offset + 1] / 255;
      const b = data[offset + 2] / 255;
      const luma = luminance[index];
      const maxChannel = Math.max(r, g, b);
      const minChannel = Math.min(r, g, b);
      const saturation = maxChannel - minChannel;
      const dr = r - borderStats.r;
      const dg = g - borderStats.g;
      const db = b - borderStats.b;
      const colorDistance = Math.sqrt(dr * dr * 0.36 + dg * dg * 0.42 + db * db * 0.22);
      const borderContrast = Math.abs(luma - borderStats.luma);
      affinity[index] = colorDistance * 1.18 + borderContrast * 0.68 + saturation * 0.18;

      if (isBorderPixel(x, y) && affinity[index] <= seedThreshold) {
        enqueue(index);
      }
    }
  }

  while (head < tail) {
    const index = queue[head];
    head += 1;
    const x = index % width;
    const y = Math.floor(index / width);
    const offset = index * 4;
    const r = data[offset] / 255;
    const g = data[offset + 1] / 255;
    const b = data[offset + 2] / 255;

    const tryNeighbor = (nx: number, ny: number): void => {
      if (nx < 0 || ny < 0 || nx >= width || ny >= height) {
        return;
      }

      const neighborIndex = ny * width + nx;
      if (backgroundMask[neighborIndex] || affinity[neighborIndex] > growThreshold) {
        return;
      }

      const neighborOffset = neighborIndex * 4;
      const nr = data[neighborOffset] / 255;
      const ng = data[neighborOffset + 1] / 255;
      const nb = data[neighborOffset + 2] / 255;
      const localDifference = Math.sqrt((nr - r) * (nr - r) * 0.34 + (ng - g) * (ng - g) * 0.42 + (nb - b) * (nb - b) * 0.24);

      if (localDifference > neighborThreshold && affinity[neighborIndex] > seedThreshold * 0.92) {
        return;
      }

      enqueue(neighborIndex);
    };

    tryNeighbor(x - 1, y);
    tryNeighbor(x + 1, y);
    tryNeighbor(x, y - 1);
    tryNeighbor(x, y + 1);
  }

  const rawCoverage = new Float32Array(total);
  for (let i = 0; i < total; i += 1) {
    if (backgroundMask[i]) {
      rawCoverage[i] = 0;
      continue;
    }

    const subjectConfidence = smoothstep(seedThreshold * 0.82, growThreshold * 1.38, affinity[i]);
    rawCoverage[i] = lerp(0.7, 1, subjectConfidence);
  }

  return rawCoverage;
}

function computeDistanceField(
  mask: Float32Array,
  width: number,
  height: number,
  threshold: number,
  invert: boolean,
  treatBorderAsZero: boolean,
): Float32Array {
  const total = width * height;
  const distances = new Float32Array(total);
  const largeValue = 1e6;

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const index = y * width + x;
      const present = invert ? mask[index] <= threshold : mask[index] > threshold;
      const border = x === 0 || y === 0 || x === width - 1 || y === height - 1;
      distances[index] = present && !(treatBorderAsZero && border) ? largeValue : 0;
    }
  }

  const sqrt2 = Math.SQRT2;
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const index = y * width + x;
      let value = distances[index];

      if (value > 0) {
        if (x > 0) value = Math.min(value, distances[index - 1] + 1);
        if (y > 0) value = Math.min(value, distances[index - width] + 1);
        if (x > 0 && y > 0) value = Math.min(value, distances[index - width - 1] + sqrt2);
        if (x < width - 1 && y > 0) value = Math.min(value, distances[index - width + 1] + sqrt2);
        distances[index] = value;
      }
    }
  }

  for (let y = height - 1; y >= 0; y -= 1) {
    for (let x = width - 1; x >= 0; x -= 1) {
      const index = y * width + x;
      let value = distances[index];

      if (value > 0) {
        if (x < width - 1) value = Math.min(value, distances[index + 1] + 1);
        if (y < height - 1) value = Math.min(value, distances[index + width] + 1);
        if (x < width - 1 && y < height - 1) value = Math.min(value, distances[index + width + 1] + sqrt2);
        if (x > 0 && y < height - 1) value = Math.min(value, distances[index + width - 1] + sqrt2);
        distances[index] = value;
      }
    }
  }

  return distances;
}

function findContentBounds(coverage: Float32Array, width: number, height: number, threshold: number): ContentBounds {
  let minX = width - 1;
  let minY = height - 1;
  let maxX = 0;
  let maxY = 0;
  let found = false;
  let sumX = 0;
  let sumY = 0;
  let totalWeight = 0;

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const value = coverage[y * width + x];
      if (value <= threshold) {
        continue;
      }

      found = true;
      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      maxX = Math.max(maxX, x);
      maxY = Math.max(maxY, y);
      sumX += (x + 0.5) * value;
      sumY += (y + 0.5) * value;
      totalWeight += value;
    }
  }

  if (!found || totalWeight <= 1e-6) {
    return {
      minX: 0,
      minY: 0,
      maxX: width - 1,
      maxY: height - 1,
      centroidX: width * 0.5,
      centroidY: height * 0.5,
    };
  }

  const padding = Math.max(2, Math.round(Math.min(width, height) * 0.045));

  return {
    minX: Math.max(0, minX - padding),
    minY: Math.max(0, minY - padding),
    maxX: Math.min(width - 1, maxX + padding),
    maxY: Math.min(height - 1, maxY + padding),
    centroidX: sumX / totalWeight,
    centroidY: sumY / totalWeight,
  };
}

function analyzePixels(source: CanvasImageSource): PixelAnalysis {
  const canvas = createAnalysisCanvas(source);
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) {
    throw new Error('Unable to read preprocessing pixels.');
  }

  const { width, height } = canvas;
  const { data } = ctx.getImageData(0, 0, width, height);
  const total = width * height;
  const borderStats = computeBorderStats(data, width, height);

  const luminance = new Float32Array(total);
  const coverage = new Float32Array(total);
  const gradient = new Float32Array(total);
  const interior = new Float32Array(total);
  const edgeWeight = new Float32Array(total);
  const coreWeight = new Float32Array(total);
  const shellDepth = new Float32Array(total);
  const boundaryNormalX = new Float32Array(total);
  const boundaryNormalY = new Float32Array(total);
  const shellCoord = new Float32Array(total);
  const importance = new Float32Array(total);
  const rawCoverage = new Float32Array(total);

  let hasTransparency = false;
  for (let i = 0; i < total; i += 1) {
    if (data[i * 4 + 3] / 255 < 0.995) {
      hasTransparency = true;
      break;
    }
  }

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const index = y * width + x;
      const offset = index * 4;
      const r = data[offset] / 255;
      const g = data[offset + 1] / 255;
      const b = data[offset + 2] / 255;
      const luma = r * 0.2126 + g * 0.7152 + b * 0.0722;

      luminance[index] = luma;
    }
  }

  if (hasTransparency) {
    for (let i = 0; i < total; i += 1) {
      rawCoverage[i] = data[i * 4 + 3] / 255;
    }
  } else {
    rawCoverage.set(deriveForegroundMask(data, width, height, borderStats, luminance));
  }

  const blurredCoverage = blurField(rawCoverage, width, height, 2);
  for (let i = 0; i < total; i += 1) {
    const combined = Math.max(rawCoverage[i], blurredCoverage[i] * 0.94);
    coverage[i] = smoothstep(hasTransparency ? 0.02 : 0.08, hasTransparency ? 0.92 : 0.58, combined);
  }

  const contentBounds = findContentBounds(coverage, width, height, hasTransparency ? 0.035 : 0.11);

  const sobelAt = (x: number, y: number): number => {
    const sample = (sx: number, sy: number): number => {
      const cx = clamp(sx, 0, width - 1);
      const cy = clamp(sy, 0, height - 1);
      const index = cy * width + cx;
      return luminance[index] * coverage[index];
    };

    const gx =
      -sample(x - 1, y - 1) - 2 * sample(x - 1, y) - sample(x - 1, y + 1) +
      sample(x + 1, y - 1) + 2 * sample(x + 1, y) + sample(x + 1, y + 1);
    const gy =
      -sample(x - 1, y - 1) - 2 * sample(x, y - 1) - sample(x + 1, y - 1) +
      sample(x - 1, y + 1) + 2 * sample(x, y + 1) + sample(x + 1, y + 1);

    return Math.sqrt(gx * gx + gy * gy);
  };

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      gradient[y * width + x] = clamp(sobelAt(x, y) * 0.72, 0, 1);
    }
  }

  const matteThreshold = hasTransparency ? 0.04 : 0.11;
  const distances = computeDistanceField(coverage, width, height, matteThreshold, false, true);
  const outsideDistances = computeDistanceField(coverage, width, height, matteThreshold, true, false);
  const signedDistance = new Float32Array(total);
  for (let i = 0; i < total; i += 1) {
    signedDistance[i] = coverage[i] > matteThreshold ? distances[i] : -outsideDistances[i];
  }

  const interiorNormalizer = Math.max(10, Math.min(contentBounds.maxX - contentBounds.minX + 1, contentBounds.maxY - contentBounds.minY + 1) * 0.18);
  const cropWidth = contentBounds.maxX - contentBounds.minX + 1;
  const cropHeight = contentBounds.maxY - contentBounds.minY + 1;

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const index = y * width + x;
      const dist = distances[index];
      const inside = dist > 0 ? clamp(dist / interiorNormalizer, 0, 1) : 0;
      const nx = (x + 0.5 - contentBounds.centroidX) / Math.max(1, cropWidth * 0.56);
      const ny = (y + 0.5 - contentBounds.centroidY) / Math.max(1, cropHeight * 0.56);
      const maskedCoverage = coverage[index];
      const shellBand = 1 - smoothstep(0.08, 0.42, inside);
      const transitionBand = smoothstep(0.16, 0.34, inside) * (1 - smoothstep(0.42, 0.7, inside));
      const core = clamp(smoothstep(0.32, 0.82, inside) * maskedCoverage, 0, 1);
      const silhouetteEdge = clamp(shellBand * 0.94 + (1 - maskedCoverage) * 0.24, 0, 1);
      const detailEdge = gradient[index] * 0.16 * (1.0 - core);
      const edge = clamp(silhouetteEdge + detailEdge, 0, 1);
      const sampleDistance = (sx: number, sy: number): number => {
        const cx = clamp(sx, 0, width - 1);
        const cy = clamp(sy, 0, height - 1);
        return signedDistance[cy * width + cx];
      };
      const outwardX = sampleDistance(x - 1, y) - sampleDistance(x + 1, y);
      const outwardY = sampleDistance(x, y - 1) - sampleDistance(x, y + 1);
      let normalX = outwardX;
      let normalY = outwardY;
      const normalLength = Math.hypot(normalX, normalY);
      if (normalLength > 1e-5) {
        normalX /= normalLength;
        normalY /= normalLength;
      } else {
        const fallbackLength = Math.hypot(nx, ny);
        if (fallbackLength > 1e-5) {
          normalX = nx / fallbackLength;
          normalY = ny / fallbackLength;
        } else {
          normalX = 0;
          normalY = -1;
        }
      }
      const shell = clamp(1 - smoothstep(0.08, 0.42, inside), 0, 1);

      coverage[index] = maskedCoverage;
      interior[index] = inside;
      edgeWeight[index] = edge;
      coreWeight[index] = core;
      shellDepth[index] = shellBand;
      boundaryNormalX[index] = normalX;
      boundaryNormalY[index] = normalY;
      shellCoord[index] = inside;
      importance[index] =
        maskedCoverage *
        (0.24 + core * 0.92 + transitionBand * 0.28 + shellBand * 0.16 + Math.pow(gradient[index], 0.82) * 0.16);
    }
  }

  return {
    width,
    height,
    color: data,
    luminance,
    coverage,
    gradient,
    interior,
    edgeWeight,
    coreWeight,
    shellDepth,
    boundaryNormalX,
    boundaryNormalY,
    shellCoord,
    importance,
    cropMinX: contentBounds.minX,
    cropMinY: contentBounds.minY,
    cropWidth,
    cropHeight,
  };
}

function createTexture(data: Float32Array, resolution: number): DataTexture {
  const texture = new DataTexture(data, resolution, resolution, RGBAFormat, FloatType);
  texture.minFilter = NearestFilter;
  texture.magFilter = NearestFilter;
  texture.generateMipmaps = false;
  texture.wrapS = ClampToEdgeWrapping;
  texture.wrapT = ClampToEdgeWrapping;
  texture.needsUpdate = true;
  return texture;
}

function binarySearchCdf(cdf: Float32Array, value: number): number {
  let low = 0;
  let high = cdf.length - 1;

  while (low < high) {
    const mid = (low + high) >>> 1;
    if (value <= cdf[mid]) {
      high = mid;
    } else {
      low = mid + 1;
    }
  }

  return low;
}

export function preprocessImage(source: CanvasImageSource, resolution: number): ProcessedParticleImage {
  const analysis = analyzePixels(source);
  const particleCount = resolution * resolution;
  const aspect = analysis.cropWidth / analysis.cropHeight;
  const worldWidth = aspect >= 1 ? RENDER_CONSTANTS.longestImageSide : RENDER_CONSTANTS.longestImageSide * aspect;
  const worldHeight = aspect >= 1 ? RENDER_CONSTANTS.longestImageSide / aspect : RENDER_CONSTANTS.longestImageSide;

  const cdf = new Float32Array(analysis.importance.length);
  let totalWeight = 0;
  for (let i = 0; i < analysis.importance.length; i += 1) {
    totalWeight += Math.max(analysis.importance[i], 0);
    cdf[i] = totalWeight;
  }

  if (totalWeight <= 1e-6) {
    for (let i = 0; i < analysis.coverage.length; i += 1) {
      totalWeight += Math.max(analysis.coverage[i], 0.001);
      cdf[i] = totalWeight;
    }
  }

  const anchorData = new Float32Array(particleCount * 4);
  const boundaryData = new Float32Array(particleCount * 4);
  const positionData = new Float32Array(particleCount * 4);
  const velocityData = new Float32Array(particleCount * 4);
  const colorData = new Float32Array(particleCount * 4);
  const metaData = new Float32Array(particleCount * 4);

  for (let i = 0; i < particleCount; i += 1) {
    const [uBase, vBase] = r2Sequence(i + 1);
    const selector = (uBase + hash11(i * 0.73) * 0.19) % 1;
    const pixelIndex = binarySearchCdf(cdf, selector * totalWeight);
    const x = pixelIndex % analysis.width;
    const y = Math.floor(pixelIndex / analysis.width);
    const pixelOffset = pixelIndex * 4;

    const jitterX = (hash11(i * 5.17 + 0.37) - 0.5) * 0.72;
    const jitterY = (vBase - 0.5) * 0.72;
    const sampleX = clamp((x + 0.5 + jitterX - analysis.cropMinX) / analysis.cropWidth, 0, 1);
    const sampleY = clamp((y + 0.5 + jitterY - analysis.cropMinY) / analysis.cropHeight, 0, 1);

    const worldX = (sampleX - 0.5) * worldWidth;
    const worldY = (0.5 - sampleY) * worldHeight;

    const edge = analysis.edgeWeight[pixelIndex];
    const interior = analysis.interior[pixelIndex];
    const core = analysis.coreWeight[pixelIndex];
    const shellDepth = analysis.shellDepth[pixelIndex];
    const boundaryNormalX = analysis.boundaryNormalX[pixelIndex];
    const boundaryNormalY = analysis.boundaryNormalY[pixelIndex];
    const shellCoord = analysis.shellCoord[pixelIndex];
    const seed = hash11(i * 1.173 + edge * 11.4 + core * 9.1 + interior * 4.6);
    const depthBias =
      (hash11(i * 2.931 + 1.37) - 0.5) * (0.08 + shellDepth * 0.42 + (1 - core) * 0.08) +
      (0.22 - interior) * 0.026;
    const spawnSpread = 0.0001 + shellDepth * 0.00125 + (1 - core) * 0.00022;

    const base = i * 4;
    anchorData[base] = worldX;
    anchorData[base + 1] = worldY;
    anchorData[base + 2] = (0.18 - interior) * 0.012 + (hash11(i * 8.31 + 2.4) - 0.5) * (0.006 + shellDepth * 0.032);
    anchorData[base + 3] = core;

    boundaryData[base] = boundaryNormalX;
    boundaryData[base + 1] = boundaryNormalY;
    boundaryData[base + 2] = shellDepth;
    boundaryData[base + 3] = interior;

    positionData[base] = worldX + (hash11(i * 6.21) - 0.5) * spawnSpread;
    positionData[base + 1] = worldY + (hash11(i * 6.21 + 1.9) - 0.5) * spawnSpread;
    positionData[base + 2] = anchorData[base + 2] + depthBias * 0.024;
    positionData[base + 3] = 0;

    velocityData[base] = 0;
    velocityData[base + 1] = 0;
    velocityData[base + 2] = 0;
    velocityData[base + 3] = 0;

    colorData[base] = srgbToLinear(analysis.color[pixelOffset] / 255);
    colorData[base + 1] = srgbToLinear(analysis.color[pixelOffset + 1] / 255);
    colorData[base + 2] = srgbToLinear(analysis.color[pixelOffset + 2] / 255);
    colorData[base + 3] = clamp(0.3 + analysis.coverage[pixelIndex] * 0.34 + core * 0.14 + interior * 0.08, 0.26, 0.9);

    metaData[base] = clamp(Math.pow(edge, 1.24), 0, 1);
    metaData[base + 1] = seed;
    metaData[base + 2] = depthBias;
    metaData[base + 3] = shellCoord;
  }

  const anchorTexture = createTexture(anchorData, resolution);
  const boundaryTexture = createTexture(boundaryData, resolution);
  const colorTexture = createTexture(colorData, resolution);
  const metaTexture = createTexture(metaData, resolution);
  const initialPositionTexture = createTexture(positionData, resolution);
  const initialVelocityTexture = createTexture(velocityData, resolution);

  return {
    resolution,
    particleCount,
    worldWidth,
    worldHeight,
    anchorTexture,
    boundaryTexture,
    colorTexture,
    metaTexture,
    initialPositionTexture,
    initialVelocityTexture,
    dispose(): void {
      anchorTexture.dispose();
      boundaryTexture.dispose();
      colorTexture.dispose();
      metaTexture.dispose();
      initialPositionTexture.dispose();
      initialVelocityTexture.dispose();
    },
  };
}
