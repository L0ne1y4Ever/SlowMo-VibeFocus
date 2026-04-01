import {
  ACESFilmicToneMapping,
  SRGBColorSpace,
  WebGLRenderer,
} from 'three';
import { RENDER_CONSTANTS } from '../config/defaults';

export class RendererManager {
  readonly renderer: WebGLRenderer;
  readonly canvas: HTMLCanvasElement;

  constructor(private readonly host: HTMLElement) {
    this.renderer = new WebGLRenderer({
      antialias: true,
      alpha: true,
      powerPreference: 'high-performance',
    });
    this.renderer.setClearColor(RENDER_CONSTANTS.clearColor, 0);
    this.renderer.outputColorSpace = SRGBColorSpace;
    this.renderer.toneMapping = ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.08;
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));

    if (!this.renderer.capabilities.isWebGL2) {
      throw new Error('SlowMoFocus requires WebGL2 for its GPU simulation pipeline.');
    }

    this.canvas = this.renderer.domElement;
    this.canvas.className = 'webgl-canvas';
    this.host.appendChild(this.canvas);
  }

  resize(): { width: number; height: number } {
    const width = this.host.clientWidth;
    const height = this.host.clientHeight;
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
    this.renderer.setSize(width, height, false);
    return { width, height };
  }

  dispose(): void {
    this.renderer.dispose();
  }
}
