import {
  Group,
  PerspectiveCamera,
  Plane,
  Raycaster,
  Scene,
  Vector2,
  Vector3,
} from 'three';
import { RENDER_CONSTANTS } from '../config/defaults';
import { damp } from '../utils/math';

export class SceneRig {
  readonly scene = new Scene();
  readonly camera = new PerspectiveCamera(RENDER_CONSTANTS.cameraFov, 1, 0.1, 20);
  readonly particleGroup = new Group();
  private targetRotation = new Vector2();
  private currentRotation = new Vector2();
  private readonly raycaster = new Raycaster();
  private readonly groundPlane = new Plane(new Vector3(0, 0, 1), 0);

  constructor() {
    this.camera.position.set(0, 0, RENDER_CONSTANTS.cameraDistance);
    this.camera.lookAt(0, 0, 0);
    this.scene.add(this.particleGroup);
  }

  resize(width: number, height: number): void {
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
  }

  dragBy(deltaX: number, deltaY: number, parallaxAmount: number): void {
    const dragScale = 0.003 + parallaxAmount * 0.006;
    this.targetRotation.y += deltaX * dragScale;
    this.targetRotation.x += deltaY * dragScale * 0.94;
    this.targetRotation.x = Math.max(-0.3, Math.min(0.3, this.targetRotation.x));
    this.targetRotation.y = Math.max(-0.5, Math.min(0.5, this.targetRotation.y));
  }

  update(delta: number): void {
    this.currentRotation.x = damp(this.currentRotation.x, this.targetRotation.x, 4.0, delta);
    this.currentRotation.y = damp(this.currentRotation.y, this.targetRotation.y, 4.0, delta);

    const dist = RENDER_CONSTANTS.cameraDistance;
    const cosPitch = Math.cos(this.currentRotation.x);
    this.camera.position.x = Math.sin(this.currentRotation.y) * cosPitch * dist;
    this.camera.position.y = Math.sin(this.currentRotation.x) * dist;
    this.camera.position.z = Math.cos(this.currentRotation.y) * cosPitch * dist;
    this.camera.lookAt(0, 0, 0);
  }

  screenToUV(ndcX: number, ndcY: number, aspect: number): { u: number; v: number } | null {
    this.raycaster.setFromCamera(new Vector2(ndcX, ndcY), this.camera);
    const intersection = new Vector3();
    const hit = this.raycaster.ray.intersectPlane(this.groundPlane, intersection);
    if (!hit) return null;

    const u = intersection.x / aspect + 0.5;
    const v = 0.5 - intersection.y;

    if (u < -0.1 || u > 1.1 || v < -0.1 || v > 1.1) return null;
    return { u, v };
  }
}
