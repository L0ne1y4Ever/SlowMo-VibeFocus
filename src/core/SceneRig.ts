import {
  PerspectiveCamera,
  Plane,
  Raycaster,
  Scene,
  Vector2,
  Vector3,
  Group,
} from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { RENDER_CONSTANTS } from '../config/defaults';
import type { ContentFrame } from '../image/ImageAnalyzer';

export class SceneRig {
  readonly scene = new Scene();
  readonly camera = new PerspectiveCamera(RENDER_CONSTANTS.cameraFov, 1, 0.1, 20);
  readonly particleGroup = new Group();
  readonly controls: OrbitControls;
  private readonly raycaster = new Raycaster();
  private readonly groundPlane = new Plane(new Vector3(0, 0, 1), 0);
  private draggingOrbit = false;

  constructor(domElement: HTMLElement) {
    this.camera.position.set(0, 0, RENDER_CONSTANTS.cameraDistance);
    this.scene.add(this.particleGroup);

    this.controls = new OrbitControls(this.camera, domElement);
    this.controls.enablePan = false;
    this.controls.enableZoom = false;
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.09;
    this.controls.rotateSpeed = 0.9;
    this.controls.minPolarAngle = 0.22;
    this.controls.maxPolarAngle = Math.PI - 0.22;
    this.controls.target.set(0, 0, 0.1);
    this.controls.addEventListener('start', this.handleControlStart);
    this.controls.addEventListener('end', this.handleControlEnd);
    this.controls.update();
  }

  resize(width: number, height: number): void {
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
  }

  get isOrbitDragging(): boolean {
    return this.draggingOrbit;
  }

  setReliefDepth(depthStrength: number): void {
    this.controls.target.set(0, 0, 0.025 + depthStrength * 0.08);
  }

  private readonly handleControlStart = (): void => {
    this.draggingOrbit = true;
  };

  private readonly handleControlEnd = (): void => {
    this.draggingOrbit = false;
  };

  update(): void {
    this.controls.update();
  }

  screenToUV(ndcX: number, ndcY: number, frame: ContentFrame): { u: number; v: number } | null {
    this.raycaster.setFromCamera(new Vector2(ndcX, ndcY), this.camera);
    const intersection = new Vector3();
    const hit = this.raycaster.ray.intersectPlane(this.groundPlane, intersection);
    if (!hit) return null;

    const u = frame.centerU + intersection.x * (frame.heightUV / frame.imageAspect);
    const v = frame.centerV - intersection.y * frame.heightUV;

    if (u < -0.1 || u > 1.1 || v < -0.1 || v > 1.1) return null;
    return { u, v };
  }

  dispose(): void {
    this.controls.removeEventListener('start', this.handleControlStart);
    this.controls.removeEventListener('end', this.handleControlEnd);
    this.controls.dispose();
  }
}
