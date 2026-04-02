import { CanvasTexture, ClampToEdgeWrapping, LinearFilter } from 'three';
import type { Texture } from 'three';
import { DEFAULT_TUNING, quantizeParticleCount, type ParticleTuning } from '../config/defaults';
import { RendererManager } from '../core/RendererManager';
import { SceneRig } from '../core/SceneRig';
import { createDemoImageCanvas } from '../image/DemoImageFactory';
import { analyzeImage, type ProcessedImage } from '../image/ImageAnalyzer';
import { loadCanvasFromFile } from '../image/ImageLoader';
import { ParticleCloud } from '../particles/ParticleCloud';
import { MouseField } from '../particles/MouseField';
import { PostStack } from '../postprocessing/PostStack';
import { AppShell } from '../ui/AppShell';
import { ControlPanel } from '../ui/ControlPanel';
import { clamp } from '../utils/math';

export class SlowMoFocusApp {
  private readonly tuning: ParticleTuning = { ...DEFAULT_TUNING };
  private shell!: AppShell;
  private rendererManager!: RendererManager;
  private sceneRig!: SceneRig;
  private controlPanel!: ControlPanel;
  private particleCloud!: ParticleCloud;
  private mouseField!: MouseField;
  private postStack!: PostStack;
  private sourceTexture: Texture | null = null;
  private processedImage: ProcessedImage | null = null;
  private currentSourceCanvas: HTMLCanvasElement | null = null;
  private animationFrameId = 0;
  private lastFrameTime = 0;
  private imageAspect = 1;
  private isRebuilding = false;
  private dragPointerId: number | null = null;
  private lastDragX = 0;
  private lastDragY = 0;

  constructor(private readonly mount: HTMLElement) {}

  init(): void {
    this.shell = new AppShell(this.mount);
    this.rendererManager = new RendererManager(this.shell.canvasHost);
    this.sceneRig = new SceneRig();

    this.particleCloud = new ParticleCloud();
    this.sceneRig.particleGroup.add(this.particleCloud.points);

    this.mouseField = new MouseField(this.rendererManager.renderer);

    this.postStack = new PostStack(
      this.rendererManager.renderer,
      this.sceneRig.scene,
      this.sceneRig.camera,
    );

    this.controlPanel = new ControlPanel(this.shell.guiHost, this.tuning, {
      onLiveChange: () => this.applyTuning(),
      onParticleCountCommit: () => {
        void this.rebuildFromCurrentSource('Particle density retuned');
      },
    });

    this.bindEvents();
    this.handleResize();
    this.shell.setBackgroundIntensity(this.tuning.backgroundIntensity);
    this.currentSourceCanvas = createDemoImageCanvas();
    void this.rebuildFromCurrentSource('Demo source loaded');
    this.animationFrameId = window.requestAnimationFrame(this.animate);
  }

  private bindEvents(): void {
    window.addEventListener('resize', this.handleResize);
    window.addEventListener('keydown', this.handleKeyDown);
    this.shell.uploadButton.addEventListener('click', this.triggerUpload);
    this.shell.uploadInput.addEventListener('change', this.handleUploadChange);
    this.shell.canvasHost.addEventListener('pointermove', this.handlePointerMove);
    this.shell.canvasHost.addEventListener('pointerleave', this.handlePointerLeave);
    this.shell.canvasHost.addEventListener('pointerdown', this.handlePointerDown);
    this.shell.canvasHost.addEventListener('pointerup', this.handlePointerUp);
    this.shell.canvasHost.addEventListener('pointercancel', this.handlePointerUp);
    this.shell.canvasHost.addEventListener('contextmenu', (e) => e.preventDefault());
  }

  private readonly handleResize = (): void => {
    const { width, height } = this.rendererManager.resize();
    this.sceneRig.resize(width, height);
    this.particleCloud.updateViewport(width, height);
    this.postStack.resize(width, height);
  };

  private readonly handlePointerDown = (event: PointerEvent): void => {
    this.dragPointerId = event.pointerId;
    this.lastDragX = event.clientX;
    this.lastDragY = event.clientY;
    this.shell.canvasHost.setPointerCapture(event.pointerId);
  };

  private readonly handlePointerMove = (event: PointerEvent): void => {
    if (this.dragPointerId === event.pointerId) {
      const deltaX = event.clientX - this.lastDragX;
      const deltaY = event.clientY - this.lastDragY;
      this.lastDragX = event.clientX;
      this.lastDragY = event.clientY;
      this.sceneRig.dragBy(deltaX, deltaY, 0.2);
    }

    const rect = this.shell.canvasHost.getBoundingClientRect();
    const canvasX = event.clientX - rect.left;
    const canvasY = event.clientY - rect.top;
    const ndcX = (canvasX / rect.width) * 2 - 1;
    const ndcY = -(canvasY / rect.height) * 2 + 1;

    const uv = this.sceneRig.screenToUV(ndcX, ndcY, this.imageAspect);
    if (uv) {
      this.mouseField.setMouseUV(uv.u, uv.v);
    }
  };

  private readonly handlePointerUp = (event: PointerEvent): void => {
    if (this.dragPointerId === event.pointerId) {
      if (this.shell.canvasHost.hasPointerCapture(event.pointerId)) {
        this.shell.canvasHost.releasePointerCapture(event.pointerId);
      }
      this.dragPointerId = null;
    }
  };

  private readonly handlePointerLeave = (): void => {
    this.mouseField.setMouseInactive();
  };

  private readonly handleKeyDown = (event: KeyboardEvent): void => {
    if (event.code === 'KeyT') {
      this.controlPanel.toggle();
    }
  };

  private readonly triggerUpload = (): void => {
    this.shell.uploadInput.click();
  };

  private readonly handleUploadChange = async (): Promise<void> => {
    const [file] = this.shell.uploadInput.files ?? [];
    if (!file) return;

    try {
      this.shell.setStatus('Loading upload...', `Preparing "${file.name}".`);
      this.currentSourceCanvas = await loadCanvasFromFile(file);
      await this.rebuildFromCurrentSource(`Uploaded: ${file.name}`);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown upload error.';
      this.shell.setStatus('Upload failed', message);
      console.error(error);
    } finally {
      this.shell.uploadInput.value = '';
    }
  };

  private applyTuning(): void {
    this.shell.setBackgroundIntensity(this.tuning.backgroundIntensity);
    this.particleCloud.updateTuning(this.tuning);
    this.postStack.updateTuning(this.tuning);
    this.mouseField.updateMouseRadius(this.tuning.mouseRadius);
  }

  private async rebuildFromCurrentSource(reason: string): Promise<void> {
    if (!this.currentSourceCanvas || this.isRebuilding) return;
    this.isRebuilding = true;
    this.shell.setStatus('Analyzing image...', 'Computing edges, distance field, and silhouette.');

    await new Promise<void>((resolve) => window.requestAnimationFrame(() => resolve()));

    try {
      const canvas = this.currentSourceCanvas;
      this.imageAspect = canvas.width / canvas.height;

      // Dispose previous
      this.sourceTexture?.dispose();
      this.processedImage?.dispose();

      // Source texture
      this.sourceTexture = new CanvasTexture(canvas);
      this.sourceTexture.flipY = false;
      this.sourceTexture.minFilter = LinearFilter;
      this.sourceTexture.magFilter = LinearFilter;
      this.sourceTexture.wrapS = ClampToEdgeWrapping;
      this.sourceTexture.wrapT = ClampToEdgeWrapping;
      this.sourceTexture.needsUpdate = true;

      // Analyze image → edge mask, distance field, silhouette
      this.processedImage = analyzeImage(canvas);

      const { count, gridX, gridY } = quantizeParticleCount(this.tuning.particleCount);

      this.particleCloud.rebuild(gridX, gridY, this.imageAspect);
      this.particleCloud.setSourceImage(this.sourceTexture);
      this.particleCloud.setMaskTexture(this.processedImage.maskTexture);
      this.particleCloud.setMouseTexture(this.mouseField.texture);
      this.particleCloud.updateViewport(
        this.shell.canvasHost.clientWidth,
        this.shell.canvasHost.clientHeight,
      );
      this.applyTuning();

      this.shell.setStatus(reason, 'Stable core, living edge. Drag to orbit, hover for disturbance.');
      this.shell.setParticleMeta(`${count.toLocaleString()} particles`);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Rebuild failed.';
      this.shell.setStatus('Rebuild failed', message);
      console.error(error);
    } finally {
      this.isRebuilding = false;
    }
  }

  private readonly animate = (time: number): void => {
    const elapsedTime = time * 0.001;
    const delta = this.lastFrameTime === 0
      ? 1 / 60
      : clamp((time - this.lastFrameTime) * 0.001, 1 / 240, 1 / 24);
    this.lastFrameTime = time;

    this.sceneRig.update(delta);
    this.particleCloud.updateTime(elapsedTime);

    this.mouseField.update(delta);
    this.particleCloud.setMouseTexture(this.mouseField.texture);

    this.postStack.updateCamera(this.sceneRig.camera);
    this.postStack.render(delta);

    this.animationFrameId = window.requestAnimationFrame(this.animate);
  };

  dispose(): void {
    window.cancelAnimationFrame(this.animationFrameId);
    window.removeEventListener('resize', this.handleResize);
    window.removeEventListener('keydown', this.handleKeyDown);
    this.shell.uploadButton.removeEventListener('click', this.triggerUpload);
    this.shell.uploadInput.removeEventListener('change', this.handleUploadChange);
    this.shell.canvasHost.removeEventListener('pointermove', this.handlePointerMove);
    this.shell.canvasHost.removeEventListener('pointerleave', this.handlePointerLeave);
    this.shell.canvasHost.removeEventListener('pointerdown', this.handlePointerDown);
    this.shell.canvasHost.removeEventListener('pointerup', this.handlePointerUp);
    this.shell.canvasHost.removeEventListener('pointercancel', this.handlePointerUp);
    this.controlPanel.dispose();
    this.particleCloud.dispose();
    this.mouseField.dispose();
    this.postStack.dispose();
    this.sourceTexture?.dispose();
    this.processedImage?.dispose();
    this.rendererManager.dispose();
    this.shell.dispose();
  }
}
