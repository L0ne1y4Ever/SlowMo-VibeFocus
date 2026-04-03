import { clamp, damp } from '../utils/math';

export interface AudioFrame {
  readonly level: number;
  readonly bass: number;
  readonly mid: number;
  readonly high: number;
  readonly active: boolean;
}

const SILENT_AUDIO: AudioFrame = {
  level: 0,
  bass: 0,
  mid: 0,
  high: 0,
  active: false,
};

export class AudioInputManager {
  private audioContext: AudioContext | null = null;
  private analyser: AnalyserNode | null = null;
  private mediaStream: MediaStream | null = null;
  private sampleBuffer: Uint8Array<ArrayBuffer> | null = null;
  private frequencyBuffer: Uint8Array<ArrayBuffer> | null = null;
  private startPromise: Promise<boolean> | null = null;
  private audioFrame: AudioFrame = SILENT_AUDIO;

  async enable(): Promise<boolean> {
    if (this.analyser) {
      if (this.audioContext?.state === 'suspended') {
        await this.audioContext.resume();
      }
      return true;
    }

    if (this.startPromise) {
      return this.startPromise;
    }

    this.startPromise = this.startInternal();
    const started = await this.startPromise;
    this.startPromise = null;
    return started;
  }

  async ensureStarted(): Promise<boolean> {
    return this.enable();
  }

  private async startInternal(): Promise<boolean> {
    if (!navigator.mediaDevices?.getUserMedia) {
      return false;
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
        video: false,
      });

      const AudioContextCtor = window.AudioContext ?? (window as typeof window & {
        webkitAudioContext?: typeof AudioContext;
      }).webkitAudioContext;

      if (!AudioContextCtor) {
        stream.getTracks().forEach((track) => track.stop());
        return false;
      }

      const context = new AudioContextCtor();
      if (context.state === 'suspended') {
        await context.resume();
      }

      const analyser = context.createAnalyser();
      analyser.fftSize = 1024;
      analyser.smoothingTimeConstant = 0.78;

      const source = context.createMediaStreamSource(stream);
      source.connect(analyser);

      this.audioContext = context;
      this.analyser = analyser;
      this.mediaStream = stream;
      this.sampleBuffer = new Uint8Array(new ArrayBuffer(analyser.fftSize));
      this.frequencyBuffer = new Uint8Array(new ArrayBuffer(analyser.frequencyBinCount));
      this.audioFrame = { ...SILENT_AUDIO };
      return true;
    } catch {
      this.audioFrame = { ...SILENT_AUDIO };
      return false;
    }
  }

  disable(): void {
    this.mediaStream?.getTracks().forEach((track) => track.stop());
    void this.audioContext?.close();
    this.audioContext = null;
    this.analyser = null;
    this.mediaStream = null;
    this.sampleBuffer = null;
    this.frequencyBuffer = null;
    this.audioFrame = SILENT_AUDIO;
  }

  private computeBandEnergy(
    buffer: Uint8Array,
    analyser: AnalyserNode,
    minHz: number,
    maxHz: number,
  ): number {
    const nyquist = (this.audioContext?.sampleRate ?? 48_000) * 0.5;
    const start = Math.max(0, Math.floor((minHz / nyquist) * analyser.frequencyBinCount));
    const end = Math.min(
      analyser.frequencyBinCount,
      Math.max(start + 1, Math.ceil((maxHz / nyquist) * analyser.frequencyBinCount)),
    );

    let sum = 0;
    let count = 0;
    for (let i = start; i < end; i++) {
      sum += buffer[i] / 255;
      count++;
    }

    return count > 0 ? clamp(sum / count, 0, 1) : 0;
  }

  update(delta: number): AudioFrame {
    if (!this.analyser || !this.sampleBuffer || !this.frequencyBuffer) {
      this.audioFrame = SILENT_AUDIO;
      return this.audioFrame;
    }

    this.analyser.getByteTimeDomainData(this.sampleBuffer);
    this.analyser.getByteFrequencyData(this.frequencyBuffer);

    let rms = 0;
    for (let i = 0; i < this.sampleBuffer.length; i++) {
      const centered = this.sampleBuffer[i] / 128 - 1;
      rms += centered * centered;
    }
    rms = Math.sqrt(rms / this.sampleBuffer.length);

    const rawLevel = clamp((rms - 0.02) / 0.18, 0, 1);
    const bass = clamp(this.computeBandEnergy(this.frequencyBuffer, this.analyser, 30, 180) * 1.3, 0, 1);
    const mid = clamp(this.computeBandEnergy(this.frequencyBuffer, this.analyser, 180, 1800) * 1.15, 0, 1);
    const high = clamp(this.computeBandEnergy(this.frequencyBuffer, this.analyser, 1800, 8000) * 1.1, 0, 1);

    const prev = this.audioFrame;
    const attack = 18;
    const decay = 5.5;
    const levelSmoothing = rawLevel > prev.level ? attack : decay;
    const bassSmoothing = bass > prev.bass ? attack * 0.8 : decay * 0.9;
    const midSmoothing = mid > prev.mid ? attack * 0.75 : decay;
    const highSmoothing = high > prev.high ? attack * 0.7 : decay * 1.1;

    this.audioFrame = {
      active: true,
      level: damp(prev.level, rawLevel, levelSmoothing, delta),
      bass: damp(prev.bass, bass, bassSmoothing, delta),
      mid: damp(prev.mid, mid, midSmoothing, delta),
      high: damp(prev.high, high, highSmoothing, delta),
    };

    return this.audioFrame;
  }

  get frame(): AudioFrame {
    return this.audioFrame;
  }

  dispose(): void {
    this.disable();
  }
}
