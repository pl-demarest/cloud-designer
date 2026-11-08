import * as THREE from 'three';
import { Viewport } from '../Viewport';
import { useCloudStore } from '../../store/cloudStore';

export class AxisGizmo {
  private viewport: Viewport;
  private frontHandle: THREE.Mesh;
  private backHandle: THREE.Mesh;
  private arrow: THREE.ArrowHelper;
  private group: THREE.Group;

  private dragTarget: 'front' | 'back' | null = null;
  private dragMoved = false;
  private dragPlane = new THREE.Plane();
  private raycaster = new THREE.Raycaster();
  private pointer = new THREE.Vector2();
  private dragOffset = new THREE.Vector3();

  private unsubscribe: () => void;

  constructor(viewport: Viewport) {
    this.viewport = viewport;
    this.group = viewport.gizmoGroup;

    const hGeo = new THREE.SphereGeometry(0.2, 12, 8);
    this.frontHandle = new THREE.Mesh(hGeo, viewport.materials.gizmoFront);
    this.frontHandle.userData.isAxisGizmo = true;
    this.frontHandle.userData.which = 'front';
    this.frontHandle.renderOrder = 999;

    // Add text label sprites via canvas
    this.frontHandle.add(this.makeLabel('F'));

    this.backHandle = new THREE.Mesh(hGeo.clone(), viewport.materials.gizmoBack);
    this.backHandle.userData.isAxisGizmo = true;
    this.backHandle.userData.which = 'back';
    this.backHandle.renderOrder = 999;
    this.backHandle.add(this.makeLabel('B'));

    const dir = new THREE.Vector3(0, 0, -1);
    this.arrow = new THREE.ArrowHelper(dir, new THREE.Vector3(), 1, 0x888888, 0.3, 0.15);

    this.group.add(this.frontHandle, this.backHandle, this.arrow);

    // Sync from store
    this.unsubscribe = useCloudStore.subscribe(
      (s) => s.preset.flowCloud.wireframe,
      (wf) => this.applyPositions(wf.frontPoint, wf.backPoint)
    );
    const wf = useCloudStore.getState().preset.flowCloud.wireframe;
    this.applyPositions(wf.frontPoint, wf.backPoint);

    const canvas = viewport.renderer.domElement;
    canvas.addEventListener('pointerdown', this.onPointerDown);
    canvas.addEventListener('pointermove', this.onPointerMove);
    canvas.addEventListener('pointerup', this.onPointerUp);
    window.addEventListener('pointerup', this.onWindowPointerUp);
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

  private getPointer(e: PointerEvent): void {
    const rect = this.viewport.renderer.domElement.getBoundingClientRect();
    this.pointer.set(
      ((e.clientX - rect.left) / rect.width) * 2 - 1,
      -((e.clientY - rect.top) / rect.height) * 2 + 1
    );
  }

  private onPointerDown = (e: PointerEvent): void => {
    this.getPointer(e);
    this.raycaster.setFromCamera(this.pointer, this.viewport.camera);
    const hits = this.raycaster.intersectObjects([this.frontHandle, this.backHandle]);
    if (hits.length === 0) return;
    if (!this.viewport.claimDrag()) return;

    const hit = hits[0];
    this.dragTarget = hit.object.userData.which as 'front' | 'back';
    this.dragMoved = false;
    // Defer controls.enabled = false until first move to avoid freezing on a mere click

    const normal = this.viewport.camera.position.clone().sub(hit.point).normalize();
    this.dragPlane.setFromNormalAndCoplanarPoint(normal, hit.point);
    const wf = useCloudStore.getState().preset.flowCloud.wireframe;
    const pos = this.dragTarget === 'front' ? wf.frontPoint : wf.backPoint;
    const localPos = new THREE.Vector3(...pos);
    this.dragOffset.copy(hit.point).sub(this.viewport.activeUnitGroup.localToWorld(localPos));

    (e.target as HTMLElement).setPointerCapture(e.pointerId);
  };

  private onPointerMove = (e: PointerEvent): void => {
    if (!this.dragTarget) return;
    if (!this.dragMoved) {
      this.viewport.controls.enabled = false;
      this.dragMoved = true;
    }
    this.getPointer(e);
    this.raycaster.setFromCamera(this.pointer, this.viewport.camera);
    const target = new THREE.Vector3();
    this.raycaster.ray.intersectPlane(this.dragPlane, target);
    target.sub(this.dragOffset);

    this.viewport.activeUnitGroup.worldToLocal(target);
    const wf = useCloudStore.getState().preset.flowCloud.wireframe;
    if (this.dragTarget === 'front') {
      useCloudStore.getState().setFlowCloud({
        wireframe: { ...wf, frontPoint: [target.x, target.y, target.z] },
      });
    } else {
      useCloudStore.getState().setFlowCloud({
        wireframe: { ...wf, backPoint: [target.x, target.y, target.z] },
      });
    }
  };

  private onPointerUp = (e: PointerEvent): void => {
    if (this.dragTarget) {
      this.dragTarget = null;
      this.dragMoved = false;
      this.viewport.controls.enabled = true;
      this.viewport.releaseDrag();
      (e.target as HTMLElement).releasePointerCapture(e.pointerId);
    }
  };

  private onWindowPointerUp = (): void => {
    if (this.dragTarget) {
      this.dragTarget = null;
      this.dragMoved = false;
      this.viewport.controls.enabled = true;
      this.viewport.releaseDrag();
    }
  };

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
    const canvas = this.viewport.renderer.domElement;
    canvas.removeEventListener('pointerdown', this.onPointerDown);
    canvas.removeEventListener('pointermove', this.onPointerMove);
    canvas.removeEventListener('pointerup', this.onPointerUp);
    window.removeEventListener('pointerup', this.onWindowPointerUp);
  }
}
