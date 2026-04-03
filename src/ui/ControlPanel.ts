import GUI from 'lil-gui';
import type { ParticleTuning } from '../config/defaults';

interface ControlPanelCallbacks {
  onLiveChange: () => void;
  onParticleCountCommit: () => void;
  onMicToggle: (enabled: boolean) => void;
}

export interface ControlPanelState {
  micEnabled: boolean;
}

export class ControlPanel {
  private readonly gui: GUI;
  private visible: boolean;
  private readonly micController: ReturnType<GUI['add']>;

  constructor(
    container: HTMLElement,
    tuning: ParticleTuning,
    state: ControlPanelState,
    callbacks: ControlPanelCallbacks,
  ) {
    this.gui = new GUI({
      container,
      title: 'Particle Tuning',
      closeFolders: false,
    });

    this.gui.domElement.classList.add('dev-gui');
    this.visible = import.meta.env.DEV;
    if (!this.visible) {
      this.gui.hide();
    }

    this.gui.add(tuning, 'particleCount', 65_536, 1_048_576, 4096).name('Particle Count').onFinishChange(() => {
      callbacks.onParticleCountCommit();
      callbacks.onLiveChange();
    });
    this.gui.add(tuning, 'particleSize', 0.5, 5.0, 0.01).name('Particle Size').onChange(callbacks.onLiveChange);
    this.gui.add(tuning, 'contrast', 0.5, 3.0, 0.01).name('Contrast').onChange(callbacks.onLiveChange);
    this.gui.add(tuning, 'colorTint', 0.0, 1.0, 0.01).name('Color Tint').onChange(callbacks.onLiveChange);
    this.gui.add(tuning, 'alphaGain', 0.1, 3.0, 0.01).name('Alpha Gain').onChange(callbacks.onLiveChange);

    const motion = this.gui.addFolder('Motion');
    motion.add(tuning, 'flowSpeed', 0.0, 0.5, 0.01).name('Flow Speed').onChange(callbacks.onLiveChange);
    motion.add(tuning, 'flowAmplitude', 0.0, 0.03, 0.001).name('Flow Amplitude').onChange(callbacks.onLiveChange);
    motion.add(tuning, 'edgeLooseness', 0.0, 2.0, 0.01).name('Edge Looseness').onChange(callbacks.onLiveChange);
    motion.add(tuning, 'depthStrength', 0.0, 1.0, 0.01).name('Depth Strength').onChange(callbacks.onLiveChange);

    const mouse = this.gui.addFolder('Mouse');
    mouse.add(tuning, 'mouseRadius', 0.02, 0.2, 0.005).name('Radius').onChange(callbacks.onLiveChange);
    mouse.add(tuning, 'mouseStrength', 0.0, 1.0, 0.01).name('Strength').onChange(callbacks.onLiveChange);

    const audio = this.gui.addFolder('Audio');
    this.micController = audio
      .add(state, 'micEnabled')
      .name('Mic Input')
      .onChange((value: boolean) => callbacks.onMicToggle(value));

    const post = this.gui.addFolder('Post-Processing');
    post.add(tuning, 'bloomStrength', 0.0, 1.0, 0.01).name('Bloom Strength').onChange(callbacks.onLiveChange);
    post.add(tuning, 'bloomRadius', 0.0, 1.0, 0.01).name('Bloom Radius').onChange(callbacks.onLiveChange);
    post.add(tuning, 'bloomThreshold', 0.5, 1.0, 0.01).name('Bloom Threshold').onChange(callbacks.onLiveChange);
    post.add(tuning, 'chromaticAberration', 0.0, 3.0, 0.1).name('Chromatic Shift').onChange(callbacks.onLiveChange);
  }

  toggle(): void {
    this.visible = !this.visible;
    if (this.visible) {
      this.gui.show();
    } else {
      this.gui.hide();
    }
  }

  dispose(): void {
    this.gui.destroy();
  }

  refresh(): void {
    this.micController.updateDisplay();
  }
}
