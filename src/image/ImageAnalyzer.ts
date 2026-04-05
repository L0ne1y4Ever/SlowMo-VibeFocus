import { DataTexture, FloatType, RGBAFormat } from 'three';

export interface ProcessedImage {
  readonly analysisTexture: DataTexture;
  readonly contentFrame: ContentFrame;
  dispose(): void;
}

export interface ContentFrame {
  readonly centerU: number;
  readonly centerV: number;
  readonly heightUV: number;
  readonly imageAspect: number;
  readonly worldAspect: number;
}

export function analyzeImage(source: HTMLCanvasElement): ProcessedImage {
  const aspectRatio = source.width / source.height;
  
  const contentFrame: ContentFrame = {
    centerU: 0.5,
    centerV: 0.5,
    heightUV: 1.0,
    imageAspect: aspectRatio,
    worldAspect: aspectRatio,
  };

  // We no longer need heavy CPU-side image analysis. 
  // We use a 1x1 dummy texture because the shader computes radial distances mathematically.
  const dummyData = new Float32Array([1, 0, 0, 0]); // occupancy=1
  const analysisTexture = new DataTexture(dummyData, 1, 1, RGBAFormat, FloatType);
  analysisTexture.needsUpdate = true;

  return {
    analysisTexture,
    contentFrame,
    dispose() {
      analysisTexture.dispose();
    },
  };
}
