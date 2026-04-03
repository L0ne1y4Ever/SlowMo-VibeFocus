import { CanvasTexture, ClampToEdgeWrapping, LinearFilter, SRGBColorSpace } from 'three';
import type { Texture } from 'three';
import { AudioInputManager } from '../audio/AudioInputManager';
import { DEFAULT_TUNING, quantizeParticleCount, type ParticleTuning } from '../config/defaults';
import { RendererManager } from '../core/RendererManager';
import { SceneRig } from '../core/SceneRig';
import { createDemoImageCanvas } from '../image/DemoImageFactory';
import { analyzeImage, type ContentFrame, type ProcessedImage } from '../image/ImageAnalyzer';
import { loadCanvasFromFile } from '../image/ImageLoader';
import { ParticleCloud } from '../particles/ParticleCloud';
import { MouseField } from '../particles/MouseField';
import { PostStack } from '../postprocessing/PostStack';
import { AppShell } from '../ui/AppShell';
import { ControlPanel, type ControlPanelState } from '../ui/ControlPanel';
import { clamp } from '../utils/math';

export class SlowMoFocusApp {
  private readonly tuning: ParticleTuning = { ...DEFAULT_TUNING };
  private shell!: AppShell;
  private rendererManager!: RendererManager;
  private sceneRig!: SceneRig;
  private controlPanel!: ControlPanel;
  private readonly controlState: ControlPanelState = { micEnabled: false };
  private particleCloud!: ParticleCloud;
  private mouseField!: MouseField;
  private postStack!: PostStack;
  private audioInput!: AudioInputManager;
  private sourceTexture: Texture | null = null;
  private processedImage: ProcessedImage | null = null;
  private currentSourceCanvas: HTMLCanvasElement | null = null;
  private animationFrameId = 0;
  private lastFrameTime = 0;
  private contentFrame: ContentFrame = {
    centerU: 0.5,
    centerV: 0.5,
    heightUV: 1,
    imageAspect: 1,
    worldAspect: 1,
  };
  private isRebuilding = false;

  constructor(private readonly mount: HTMLElement) {}

  init(): void {
    this.shell = new AppShell(this.mount);
    this.rendererManager = new RendererManager(this.shell.canvasHost);
    this.sceneRig = new SceneRig(this.shell.canvasHost);

    this.particleCloud = new ParticleCloud();
    this.sceneRig.particleGroup.add(this.particleCloud.group);

    this.mouseField = new MouseField(this.rendererManager.renderer);
    this.audioInput = new AudioInputManager();

    this.postStack = new PostStack(
      this.rendererManager.renderer,
      this.sceneRig.scene,
      this.sceneRig.camera,
    );

    this.controlPanel = new ControlPanel(this.shell.guiHost, this.tuning, this.controlState, {
      onLiveChange: () => this.applyTuning(),
      onParticleCountCommit: () => {
        void this.rebuildFromCurrentSource('Particle density retuned');
      },
      onMicToggle: (enabled) => {
        void this.handleMicToggle(enabled);
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
    this.postStack.setBaseAccumulationTexture(this.particleCloud.baseAccumulationTexture);
    this.postStack.resize(width, height);
  };

  private updateHoverFromClient(clientX: number, clientY: number): void {
    if (this.sceneRig.isOrbitDragging) {
      this.mouseField.setMouseInactive();
      return;
    }

    const rect = this.shell.canvasHost.getBoundingClientRect();
    const canvasX = clientX - rect.left;
    const canvasY = clientY - rect.top;
    const ndcX = (canvasX / rect.width) * 2 - 1;
    const ndcY = -(canvasY / rect.height) * 2 + 1;

    const uv = this.sceneRig.screenToUV(ndcX, ndcY, this.contentFrame);
    if (uv) {
      this.mouseField.setMouseUV(uv.u, uv.v);
    } else {
      this.mouseField.setMouseInactive();
    }
  }

  private updateHoverFromPointer(event: PointerEvent): void {
    this.updateHoverFromClient(event.clientX, event.clientY);
  }

  private readonly handlePointerDown = (): void => {
    this.mouseField.setMouseInactive();
  };

  private readonly handlePointerMove = (event: PointerEvent): void => {
    if (this.sceneRig.isOrbitDragging) {
      this.mouseField.setMouseInactive();
      return;
    }

    this.updateHoverFromPointer(event);
  };

  private readonly handlePointerUp = (event: PointerEvent): void => {
    const { clientX, clientY } = event;
    window.requestAnimationFrame(() => {
      this.updateHoverFromClient(clientX, clientY);
    });
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
    this.sceneRig.setReliefDepth(this.tuning.depthStrength);
  }

  private async rebuildFromCurrentSource(reason: string): Promise<void> {
    if (!this.currentSourceCanvas || this.isRebuilding) return;
    this.isRebuilding = true;
    this.shell.setStatus('Analyzing image...', 'Computing edges, distance field, and silhouette.');

    await new Promise<void>((resolve) => window.requestAnimationFrame(() => resolve()));

    try {
      const canvas = this.currentSourceCanvas;

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
      this.sourceTexture.colorSpace = SRGBColorSpace;
      this.sourceTexture.needsUpdate = true;

      // Analyze image → occupancy, edge mask, distance field, highlight
      this.processedImage = analyzeImage(canvas);
      this.contentFrame = this.processedImage.contentFrame;

      const { count } = quantizeParticleCount(this.tuning.particleCount);

      this.particleCloud.rebuild(count, this.processedImage);
      this.particleCloud.setSourceImage(this.sourceTexture);
      this.particleCloud.setAnalysisTexture(this.processedImage.analysisTexture);
      this.particleCloud.setMouseTexture(this.mouseField.texture);
      this.particleCloud.updateViewport(
        this.shell.canvasHost.clientWidth,
        this.shell.canvasHost.clientHeight,
      );
      this.postStack.setBaseAccumulationTexture(this.particleCloud.baseAccumulationTexture);
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

    const audioFrame = this.audioInput.update(delta);
    this.sceneRig.update();
    this.particleCloud.updateTime(elapsedTime);
    this.particleCloud.updateAudio(audioFrame);

    this.mouseField.update(delta);
    this.particleCloud.setMouseTexture(this.mouseField.texture);

    this.particleCloud.renderBaseAccumulation(this.rendererManager.renderer, this.sceneRig.camera);
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
    this.audioInput.dispose();
    this.sourceTexture?.dispose();
    this.processedImage?.dispose();
    this.sceneRig.dispose();
    this.rendererManager.dispose();
    this.shell.dispose();
  }

  private readonly handleMicToggle = async (enabled: boolean): Promise<void> => {
    if (enabled) {
      const started = await this.audioInput.enable();
      if (!started) {
        this.controlState.micEnabled = false;
        this.controlPanel.refresh();
        this.shell.setStatus('Microphone unavailable', 'Idle membrane motion remains active without audio input.');
        return;
      }

      this.controlState.micEnabled = true;
      this.controlPanel.refresh();
      this.shell.setStatus('Microphone active', 'Audio-reactive membrane pulsing is now enabled.');
      return;
    }

    this.audioInput.disable();
    this.controlState.micEnabled = false;
    this.controlPanel.refresh();
    this.shell.setStatus('Microphone muted', 'Idle motion remains active while mic input is disabled.');
  };
}
