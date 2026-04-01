import GUI from 'lil-gui';
import type { ParticleTuning } from '../config/defaults';

interface ControlPanelCallbacks {
  onLiveChange: () => void;
  onParticleCountCommit: () => void;
}

export class ControlPanel {
  private readonly gui: GUI;
  private visible: boolean;

  constructor(container: HTMLElement, tuning: ParticleTuning, callbacks: ControlPanelCallbacks) {
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

    this.gui.add(tuning, 'particleCount', 65_536, 1_048_576, 4_096).name('Particle Count').onFinishChange(() => {
      callbacks.onParticleCountCommit();
      callbacks.onLiveChange();
    });
    this.gui.add(tuning, 'particleSize', 0.9, 5.5, 0.01).name('Particle Size').onChange(callbacks.onLiveChange);
    this.gui.add(tuning, 'densityCompensation', 0.7, 2.4, 0.01).name('Density Compensation').onChange(callbacks.onLiveChange);
    this.gui.add(tuning, 'alphaGain', 0.35, 2.4, 0.01).name('Alpha Gain').onChange(callbacks.onLiveChange);
    this.gui.add(tuning, 'brightness', 0.65, 1.6, 0.01).name('Brightness').onChange(callbacks.onLiveChange);

    const motion = this.gui.addFolder('Motion');
    motion.add(tuning, 'attractionStrength', 0.2, 2.4, 0.01).name('Attraction').onChange(callbacks.onLiveChange);
    motion.add(tuning, 'flowStrength', 0.05, 1.4, 0.01).name('Flow Strength').onChange(callbacks.onLiveChange);
    motion.add(tuning, 'erosionStrength', 0.05, 1.8, 0.01).name('Erosion Strength').onChange(callbacks.onLiveChange);
    motion.add(tuning, 'damping', 0.05, 0.6, 0.005).name('Damping').onChange(callbacks.onLiveChange);
    motion.add(tuning, 'motionSpeed', 0.25, 1.6, 0.01).name('Motion Speed').onChange(callbacks.onLiveChange);

    const edge = this.gui.addFolder('Edge Stability');
    edge.add(tuning, 'edgeThreshold', 0.05, 0.9, 0.01).name('Edge Threshold').onChange(callbacks.onLiveChange);
    edge.add(tuning, 'edgeBoost', 0.45, 1.8, 0.01).name('Edge Boost').onChange(callbacks.onLiveChange);
    edge.add(tuning, 'depthThickness', 0.05, 0.48, 0.005).name('Depth Thickness').onChange(callbacks.onLiveChange);

    const scene = this.gui.addFolder('Presentation');
    scene.add(tuning, 'backgroundIntensity', 0.2, 1, 0.01).name('Background').onChange(callbacks.onLiveChange);
    scene.add(tuning, 'parallaxAmount', 0, 0.42, 0.001).name('Parallax').onChange(callbacks.onLiveChange);
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
}
