import { DEFAULT_TUNING, quantizeParticleCount, type ParticleTuning } from '../config/defaults';
import { RendererManager } from '../core/RendererManager';
import { SceneRig } from '../core/SceneRig';
import { createDemoImageCanvas } from '../image/DemoImageFactory';
import { loadCanvasFromFile } from '../image/ImageLoader';
import { preprocessImage, type ProcessedParticleImage } from '../image/ImagePreprocessor';
import { ParticleField } from '../particles/ParticleField';
import { SimulationFBO } from '../particles/SimulationFBO';
import { AppShell } from '../ui/AppShell';
import { ControlPanel } from '../ui/ControlPanel';
import { clamp } from '../utils/math';

export class SlowMoFocusApp {
  private static readonly DEBUG_LABELS = [
    'Live view',
    'Debug 1: Subject matte',
    'Debug 2: Silhouette distance',
    'Debug 3: Shell eligibility',
    'Debug 4: Particle states',
    'Debug 5: Force / velocity',
  ] as const;

  private readonly tuning: ParticleTuning = { ...DEFAULT_TUNING };
  private shell!: AppShell;
  private rendererManager!: RendererManager;
  private sceneRig!: SceneRig;
  private controlPanel!: ControlPanel;
  private readonly particleField = new ParticleField();
  private simulation: SimulationFBO | null = null;
  private processedImage: ProcessedParticleImage | null = null;
  private currentSourceCanvas: HTMLCanvasElement | null = null;
  private animationFrameId = 0;
  private lastFrameTime = 0;
  private isRebuilding = false;
  private debugMode = 0;
  private particleMetaBase = '';
  private dragPointerId: number | null = null;
  private lastDragX = 0;
  private lastDragY = 0;

  constructor(private readonly mount: HTMLElement) {}

  init(): void {
    this.shell = new AppShell(this.mount);
    this.rendererManager = new RendererManager(this.shell.canvasHost);
    this.sceneRig = new SceneRig();
    this.sceneRig.particleGroup.add(this.particleField.group);

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
    this.shell.canvasHost.addEventListener('pointerdown', this.handlePointerDown);
    this.shell.canvasHost.addEventListener('pointermove', this.handlePointerMove);
    this.shell.canvasHost.addEventListener('pointerup', this.handlePointerUp);
    this.shell.canvasHost.addEventListener('pointercancel', this.handlePointerUp);
    this.shell.canvasHost.addEventListener('pointerleave', this.handlePointerUp);
  }

  private readonly handleResize = (): void => {
    const { width, height } = this.rendererManager.resize();
    this.sceneRig.resize(width, height);
    this.particleField.updateViewport(width, height);
  };

  private readonly handlePointerDown = (event: PointerEvent): void => {
    this.dragPointerId = event.pointerId;
    this.lastDragX = event.clientX;
    this.lastDragY = event.clientY;
    this.shell.canvasHost.classList.add('is-dragging');
    this.shell.canvasHost.setPointerCapture(event.pointerId);
  };

  private readonly handlePointerMove = (event: PointerEvent): void => {
    if (this.dragPointerId !== event.pointerId) {
      return;
    }

    const deltaX = event.clientX - this.lastDragX;
    const deltaY = event.clientY - this.lastDragY;
    this.lastDragX = event.clientX;
    this.lastDragY = event.clientY;
    this.sceneRig.dragBy(deltaX, deltaY, clamp(this.tuning.parallaxAmount, 0.08, 0.42));
  };

  private readonly handlePointerUp = (event: PointerEvent): void => {
    if (this.dragPointerId !== event.pointerId) {
      return;
    }

    if (this.shell.canvasHost.hasPointerCapture(event.pointerId)) {
      this.shell.canvasHost.releasePointerCapture(event.pointerId);
    }

    this.dragPointerId = null;
    this.shell.canvasHost.classList.remove('is-dragging');
  };

  private readonly handleKeyDown = (event: KeyboardEvent): void => {
    if (event.code === 'KeyT') {
      this.controlPanel.toggle();
      return;
    }

    if (event.code === 'Digit0') {
      this.setDebugMode(0);
      return;
    }

    if (/^Digit[1-5]$/.test(event.code)) {
      this.setDebugMode(Number.parseInt(event.code.slice(-1), 10));
    }
  };

  private readonly triggerUpload = (): void => {
    this.shell.uploadInput.click();
  };

  private readonly handleUploadChange = async (): Promise<void> => {
    const [file] = this.shell.uploadInput.files ?? [];
    if (!file) {
      return;
    }

    try {
      this.shell.setStatus('Loading upload…', `Preparing "${file.name}" for dense reconstruction.`);
      this.currentSourceCanvas = await loadCanvasFromFile(file);
      await this.rebuildFromCurrentSource(`Uploaded source: ${file.name}`);
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
    this.particleField.updateTuning(this.tuning);
  }

  private setDebugMode(mode: number): void {
    this.debugMode = clamp(mode, 0, 5);
    this.particleField.setDebugMode(this.debugMode);
    this.updateParticleMeta();
  }

  private updateParticleMeta(): void {
    const label = SlowMoFocusApp.DEBUG_LABELS[this.debugMode];
    const decorated = this.particleMetaBase ? `${this.particleMetaBase} · ${label}` : label;
    this.shell.setParticleMeta(decorated);
  }

  private async rebuildFromCurrentSource(reason: string): Promise<void> {
    if (!this.currentSourceCanvas || this.isRebuilding) {
      return;
    }

    this.isRebuilding = true;
    this.shell.setStatus('Analyzing source image…', 'Deriving anchor positions, core density, and erosion weights.');

    await new Promise<void>((resolve) => window.requestAnimationFrame(() => resolve()));

    try {
      const { count, resolution } = quantizeParticleCount(this.tuning.particleCount);
      const nextProcessed = preprocessImage(this.currentSourceCanvas, resolution);
      const nextSimulation = new SimulationFBO(this.rendererManager.renderer, resolution);
      nextSimulation.initialize(nextProcessed);

      this.processedImage?.dispose();
      this.simulation?.dispose();

      this.processedImage = nextProcessed;
      this.simulation = nextSimulation;
      this.particleField.rebuild(nextProcessed);
      this.particleField.setDebugMode(this.debugMode);
      this.particleField.updateViewport(this.shell.canvasHost.clientWidth, this.shell.canvasHost.clientHeight);
      this.particleField.setSimulationTextures(nextSimulation.positionTexture, nextSimulation.velocityTexture);
      this.applyTuning();

      this.shell.setStatus(reason, 'The image is now rebuilt as a dense living particle surface with a stable core and unstable contour.');
      this.particleMetaBase = `${count.toLocaleString()} particles · ${resolution} x ${resolution} simulation texture`;
      this.updateParticleMeta();
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown preprocessing failure.';
      this.shell.setStatus('Rebuild failed', message);
      console.error(error);
    } finally {
      this.isRebuilding = false;
    }
  }

  private readonly animate = (time: number): void => {
    const elapsedTime = time * 0.001;
    const delta = this.lastFrameTime === 0 ? 1 / 60 : clamp((time - this.lastFrameTime) * 0.001, 1 / 240, 1 / 24);
    this.lastFrameTime = time;

    this.sceneRig.update(delta, this.tuning.parallaxAmount);

    if (this.simulation) {
      this.simulation.update(delta, elapsedTime, this.tuning);
      this.particleField.setSimulationTextures(this.simulation.positionTexture, this.simulation.velocityTexture);
    }

    this.rendererManager.renderer.render(this.sceneRig.scene, this.sceneRig.camera);
    this.animationFrameId = window.requestAnimationFrame(this.animate);
  };

  dispose(): void {
    window.cancelAnimationFrame(this.animationFrameId);
    window.removeEventListener('resize', this.handleResize);
    window.removeEventListener('keydown', this.handleKeyDown);
    this.shell.uploadButton.removeEventListener('click', this.triggerUpload);
    this.shell.uploadInput.removeEventListener('change', this.handleUploadChange);
    this.shell.canvasHost.removeEventListener('pointerdown', this.handlePointerDown);
    this.shell.canvasHost.removeEventListener('pointermove', this.handlePointerMove);
    this.shell.canvasHost.removeEventListener('pointerup', this.handlePointerUp);
    this.shell.canvasHost.removeEventListener('pointercancel', this.handlePointerUp);
    this.shell.canvasHost.removeEventListener('pointerleave', this.handlePointerUp);
    this.controlPanel.dispose();
    this.particleField.dispose();
    this.simulation?.dispose();
    this.processedImage?.dispose();
    this.rendererManager.dispose();
    this.shell.dispose();
  }
}
