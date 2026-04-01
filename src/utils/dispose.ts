import { Material, Object3D, Texture, WebGLRenderTarget } from 'three';

function disposeMaterial(material: Material): void {
  material.dispose();
}

export function disposeObject3D(root: Object3D): void {
  root.traverse((child: Object3D) => {
    const mesh = child as Object3D & {
      geometry?: { dispose: () => void };
      material?: Material | Material[];
    };

    mesh.geometry?.dispose();

    if (Array.isArray(mesh.material)) {
      mesh.material.forEach(disposeMaterial);
    } else if (mesh.material) {
      disposeMaterial(mesh.material);
    }
  });
}

export function disposeTexture(texture?: Texture | null): void {
  texture?.dispose();
}

export function disposeRenderTarget(target?: WebGLRenderTarget | null): void {
  target?.dispose();
}
