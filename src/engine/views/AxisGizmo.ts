import * as THREE from 'three';
import { Viewport } from '../Viewport';
import { useCloudStore } from '../../store/cloudStore';
import type { DragSource, DragTarget } from '../DragController';

export class AxisGizmo implements DragSource {
  private frontHandle: THREE.Mesh;
  private backHandle: THREE.Mesh;
  private arrow: THREE.ArrowHelper;
  private group: THREE.Group;

  private unsubscribe: () => void;

  constructor(viewport: Viewport) {
    this.group = viewport.gizmoGroup;

    const hGeo = new THREE.SphereGeometry(0.2, 12, 8);
    this.frontHandle = new THREE.Mesh(hGeo, viewport.materials.gizmoFront);
    this.frontHandle.userData.editorOnly = true;
    this.frontHandle.userData.which = 'front';
    this.frontHandle.renderOrder = 999;

    // Add text label sprites via canvas
    this.frontHandle.add(this.makeLabel('F'));

    this.backHandle = new THREE.Mesh(hGeo.clone(), viewport.materials.gizmoBack);
    this.backHandle.userData.editorOnly = true;
    this.backHandle.userData.which = 'back';
    this.backHandle.renderOrder = 999;
    this.backHandle.add(this.makeLabel('B'));

    const dir = new THREE.Vector3(0, 0, -1);
    this.arrow = new THREE.ArrowHelper(dir, new THREE.Vector3(), 1, 0x888888, 0.3, 0.15);
    this.arrow.userData.editorOnly = true;

    this.group.add(this.frontHandle, this.backHandle, this.arrow);

    // Sync from store
    this.unsubscribe = useCloudStore.subscribe(
      (s) => s.preset.flowCloud.wireframe,
      (wf) => this.applyPositions(wf.frontPoint, wf.backPoint)
    );
    const wf = useCloudStore.getState().preset.flowCloud.wireframe;
    this.applyPositions(wf.frontPoint, wf.backPoint);
  }

  private makeLabel(text: string): THREE.Sprite {
    const canvas = document.createElement('canvas');
    canvas.width = 64;
    canvas.height = 64;
    const ctx = canvas.getContext('2d')!;
    ctx.fillStyle = '#fff';
    ctx.font = 'bold 40px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(text, 32, 32);
    const tex = new THREE.CanvasTexture(canvas);
    const mat = new THREE.SpriteMaterial({ map: tex, depthTest: false });
    const sprite = new THREE.Sprite(mat);
    sprite.scale.set(0.3, 0.3, 1);
    sprite.position.set(0, 0.25, 0);
    return sprite;
  }

  private applyPositions(front: [number, number, number], back: [number, number, number]): void {
    this.frontHandle.position.set(...front);
    this.backHandle.position.set(...back);

    const fp = new THREE.Vector3(...front);
    const bp = new THREE.Vector3(...back);
    const dir = bp.clone().sub(fp).normalize();
    const length = fp.distanceTo(bp);
    this.arrow.position.copy(fp);
    this.arrow.setDirection(dir);
    this.arrow.setLength(length, Math.min(0.4, length * 0.15), 0.15);
  }

  // ── Dragging (DragController) ───────────────────────────────────────────────

  /** The F and B anchors (their labels are not handles). */
  dragHandles(): THREE.Object3D[] {
    return [this.frontHandle, this.backHandle];
  }

  dragTarget(handle: THREE.Object3D): DragTarget {
    const point = handle.userData.which === 'front' ? 'frontPoint' : 'backPoint';
    return {
      position: () => useCloudStore.getState().preset.flowCloud.wireframe[point],
      moveTo: (position) => {
        const wf = useCloudStore.getState().preset.flowCloud.wireframe;
        useCloudStore.getState().setFlowCloud({ wireframe: { ...wf, [point]: position } });
        return true;
      },
    };
  }

  dispose(): void {
    this.unsubscribe();
    this.group.remove(this.frontHandle, this.backHandle, this.arrow);
    for (const handle of [this.frontHandle, this.backHandle]) {
      handle.geometry.dispose();
      for (const child of handle.children) {
        if (child instanceof THREE.Sprite) {
          child.material.map?.dispose();
          child.material.dispose();
        }
      }
    }
    this.arrow.dispose();
  }
}
