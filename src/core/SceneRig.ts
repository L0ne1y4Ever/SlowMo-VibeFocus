import {
  Group,
  PerspectiveCamera,
  Scene,
  Vector2,
} from 'three';
import { RENDER_CONSTANTS } from '../config/defaults';
import { damp } from '../utils/math';

export class SceneRig {
  readonly scene = new Scene();
  readonly camera = new PerspectiveCamera(RENDER_CONSTANTS.cameraFov, 1, 0.1, 20);
  readonly particleGroup = new Group();
  private targetRotation = new Vector2();
  private currentRotation = new Vector2();

  constructor() {
    this.camera.position.set(0, 0, RENDER_CONSTANTS.cameraDistance);
    this.scene.add(this.particleGroup);
  }

  resize(width: number, height: number): void {
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
  }

  dragBy(deltaX: number, deltaY: number, parallaxAmount: number): void {
    const dragScale = 0.0074 + parallaxAmount * 0.014;
    this.targetRotation.y += deltaX * dragScale;
    this.targetRotation.x += deltaY * dragScale * 0.94;
    this.targetRotation.x = Math.max(-1.52, Math.min(1.52, this.targetRotation.x));
  }

  update(delta: number, parallaxAmount: number): void {
    this.currentRotation.x = damp(this.currentRotation.x, this.targetRotation.x, 6.2, delta);
    this.currentRotation.y = damp(this.currentRotation.y, this.targetRotation.y, 6.2, delta);

    const orbitRadius = RENDER_CONSTANTS.cameraDistance + 0.05 + parallaxAmount * 0.18;
    const cosPitch = Math.cos(this.currentRotation.x);
    this.camera.position.x = Math.sin(this.currentRotation.y) * cosPitch * orbitRadius;
    this.camera.position.y = Math.sin(this.currentRotation.x) * orbitRadius * 0.92;
    this.camera.position.z = Math.cos(this.currentRotation.y) * cosPitch * orbitRadius;
    this.camera.lookAt(0, 0, 0);

    this.particleGroup.rotation.x = 0;
    this.particleGroup.rotation.y = 0;
  }
}
