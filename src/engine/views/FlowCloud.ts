import * as THREE from 'three';
import { Viewport } from '../Viewport';
import { useCloudStore } from '../../store/cloudStore';
import type { FlowCloudResult } from '../../workers/protocol';

/**
 * The generated flow cloud: shows each result of the flow-cloud worker (EditorEngine runs the
 * job), moves with flowCloud.position, and offers a drag handle once something is shown.
 */
export class FlowCloud {
  private viewport: Viewport;
  private group: THREE.Group;
  private currentObjects: THREE.Object3D[] = [];
  private bandsGroup: THREE.Group | null = null;
  private flowLinesGroup: THREE.Group | null = null;
  private unsubscribeWireframe: () => void;
  private unsubscribePosition: () => void;

  // Drag handle — teal box at the flow cloud group's local origin
  private handle: THREE.Mesh;
  private hasGeometry = false;
  private handlesVisible = true;

  // Drag state
  private isDragging = false;
  private dragPlane = new THREE.Plane();
  private raycaster = new THREE.Raycaster();
  private pointer = new THREE.Vector2();
  private dragOffset = new THREE.Vector3();

  constructor(viewport: Viewport) {
    this.viewport = viewport;
    this.group = viewport.flowCloudGroup;

    // Drag handle lives at local [0,0,0] of flowCloudGroup, moves with it
    const handleGeo = new THREE.BoxGeometry(0.25, 0.25, 0.25);
    this.handle = new THREE.Mesh(handleGeo, viewport.materials.flowCloudHandle);
    this.handle.userData.isHandle = true;
    this.handle.visible = false; // shown only after first Regenerate
    this.group.add(this.handle);

    // Apply initial flow cloud position from store
    const initPos = useCloudStore.getState().preset.flowCloud.position;
    this.group.position.set(initPos[0], initPos[1], initPos[2]);

    // Live-update wireframe visibility without re-running the worker
    this.unsubscribeWireframe = useCloudStore.subscribe(
      (s) => s.preset.flowCloud.wireframe,
      (wf) => {
        if (this.bandsGroup)    this.bandsGroup.visible    = wf.showBands;
        if (this.flowLinesGroup) this.flowLinesGroup.visible = wf.showFlowLines;
      }
    );

    // Move the group when flowCloud.position changes in the store
    this.unsubscribePosition = useCloudStore.subscribe(
      (s) => s.preset.flowCloud.position,
      (p) => {
        this.group.position.set(p[0], p[1], p[2]);
      }
    );

    const canvas = viewport.renderer.domElement;
    canvas.addEventListener('pointerdown', this.onPointerDown);
    canvas.addEventListener('pointermove', this.onPointerMove);
    canvas.addEventListener('pointerup',   this.onPointerUp);
    window.addEventListener('pointerup',   this.onWindowPointerUp);
  }

  /** Show or hide the drag handle. Pass false in preview mode. */
  setHandlesVisible(visible: boolean): void {
    this.handlesVisible = visible;
    this.handle.visible = visible && this.hasGeometry;
  }

  /** Replaces what is shown with a flow-cloud worker result, in the current wireframe mode. */
  show(result: FlowCloudResult): void {
    const { vertices, indices, bands, flowLines } = result;

    this.clearScene();

    const preset = useCloudStore.getState().preset;
    const mode   = preset.flowCloud.wireframe.mode;
    const { line } = this.viewport.materials;

    if (mode === 'edges' && vertices.length > 0) {
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.BufferAttribute(vertices, 3));
      geo.setIndex(new THREE.BufferAttribute(indices, 1));
      geo.computeVertexNormals();
      const edges = new THREE.EdgesGeometry(geo, 15);
      const lines = new THREE.LineSegments(edges, line);
      geo.dispose();
      this.group.add(lines);
      this.currentObjects.push(lines);
    } else if (mode === 'spiral') {
      const spiralGroup = new THREE.Group();
      spiralGroup.name = 'spiralGroup';

      const bandsGrp = new THREE.Group();
      bandsGrp.name    = 'bands';
      bandsGrp.visible = preset.flowCloud.wireframe.showBands;
      // Bands arrive from the worker as flat segment-pair data ([a0,b0,a1,b1,...]),
      // so they must be rendered as LineSegments — using THREE.Line would draw
      // spurious connecting segments between unrelated pairs.
      for (const bandArr of bands) {
        const geo = new THREE.BufferGeometry();
        geo.setAttribute('position', new THREE.BufferAttribute(bandArr, 3));
        bandsGrp.add(new THREE.LineSegments(geo, line));
      }

      const flowGrp = new THREE.Group();
      flowGrp.name    = 'flowLines';
      flowGrp.visible = preset.flowCloud.wireframe.showFlowLines;
      for (const flArr of flowLines) {
        const geo = new THREE.BufferGeometry();
        geo.setAttribute('position', new THREE.BufferAttribute(flArr, 3));
        flowGrp.add(new THREE.Line(geo, line));
      }

      spiralGroup.add(bandsGrp, flowGrp);
      this.group.add(spiralGroup);
      this.currentObjects.push(spiralGroup);

      this.bandsGroup     = bandsGrp;
      this.flowLinesGroup = flowGrp;
    }

    // Reveal the handle now that there's geometry to move
    const generated = vertices.length > 0 || bands.length > 0 || flowLines.length > 0;
    if (generated) {
      this.hasGeometry    = true;
      this.handle.visible = this.handlesVisible;
    }
  }

  // ── Pointer / drag interaction ──────────────────────────────────────────────

  private getPointer(e: PointerEvent): void {
    const rect = this.viewport.renderer.domElement.getBoundingClientRect();
    this.pointer.set(
      ((e.clientX - rect.left) / rect.width)  *  2 - 1,
      -((e.clientY - rect.top)  / rect.height) *  2 + 1
    );
  }

  private onPointerDown = (e: PointerEvent): void => {
    if (!this.handle.visible) return;
    this.getPointer(e);
    this.raycaster.setFromCamera(this.pointer, this.viewport.camera);
    const hits = this.raycaster.intersectObject(this.handle);
    if (hits.length === 0) return;
    if (!this.viewport.claimDrag()) return;

    this.isDragging = true;
    this.viewport.controls.enabled = false;

    const hit    = hits[0];
    const normal = this.viewport.camera.position.clone().sub(hit.point).normalize();
    this.dragPlane.setFromNormalAndCoplanarPoint(normal, hit.point);
    this.dragOffset.copy(hit.point).sub(this.group.position);

    (e.target as HTMLElement).setPointerCapture(e.pointerId);
  };

  private onPointerMove = (e: PointerEvent): void => {
    if (!this.isDragging) return;
    this.getPointer(e);
    this.raycaster.setFromCamera(this.pointer, this.viewport.camera);
    const target = new THREE.Vector3();
    if (!this.raycaster.ray.intersectPlane(this.dragPlane, target)) return;
    target.sub(this.dragOffset);
    useCloudStore.getState().setFlowCloud({ position: [target.x, target.y, target.z] });
  };

  private onPointerUp = (e: PointerEvent): void => {
    if (this.isDragging) {
      this.isDragging = false;
      this.viewport.controls.enabled = true;
      this.viewport.releaseDrag();
      (e.target as HTMLElement).releasePointerCapture(e.pointerId);
    }
  };

  private onWindowPointerUp = (): void => {
    if (this.isDragging) {
      this.isDragging = false;
      this.viewport.controls.enabled = true;
      this.viewport.releaseDrag();
    }
  };

  // ── Internal helpers ────────────────────────────────────────────────────────

  private clearScene(): void {
    for (const obj of this.currentObjects) {
      this.group.remove(obj);
      obj.traverse((child) => {
        if (child instanceof THREE.Line || child instanceof THREE.LineSegments) {
          child.geometry.dispose();
        }
      });
    }
    this.currentObjects = [];
    this.bandsGroup     = null;
    this.flowLinesGroup = null;
  }

  /**
   * Clear all rendered geometry.
   * The handle is hidden and hasGeometry is reset.
   */
  clear(): void {
    this.clearScene();
    this.hasGeometry    = false;
    this.handle.visible = false;
  }

  getEdges(): Float32Array {
    const verts: number[] = [];
    const v = new THREE.Vector3();
    // Use visibility-aware traversal: skip subtrees where any ancestor is invisible.
    // CutGlue consumes a flat segment-pair Float32Array (every 6 floats = one segment).
    // LineSegments vertices are already in pair format → dump as-is.
    // THREE.Line vertices are a connected polyline [P0,P1,P2,...,PN] → expand into
    //   pairs [P0,P1, P1,P2, P2,P3, ..., P(N-1),PN] so connections survive.
    // (LineSegments extends Line in three.js, so the LineSegments check must come first.)
    const traverseVisible = (obj: THREE.Object3D) => {
      if (!obj.visible) return;
      if (!obj.userData.isHandle) {
        if (obj instanceof THREE.LineSegments) {
          obj.updateWorldMatrix(true, false);
          const pos = obj.geometry.attributes.position;
          if (pos) {
            for (let i = 0; i < pos.count; i++) {
              v.fromBufferAttribute(pos, i).applyMatrix4(obj.matrixWorld);
              verts.push(v.x, v.y, v.z);
            }
          }
        } else if (obj instanceof THREE.Line) {
          obj.updateWorldMatrix(true, false);
          const pos = obj.geometry.attributes.position;
          if (pos && pos.count >= 2) {
            // Pre-compute world-space positions, then emit consecutive pairs
            const wp: number[] = [];
            for (let i = 0; i < pos.count; i++) {
              v.fromBufferAttribute(pos, i).applyMatrix4(obj.matrixWorld);
              wp.push(v.x, v.y, v.z);
            }
            for (let i = 0; i < pos.count - 1; i++) {
              const a = i * 3;
              const b = a + 3;
              verts.push(wp[a], wp[a+1], wp[a+2], wp[b], wp[b+1], wp[b+2]);
            }
          }
        }
      }
      for (const child of obj.children) traverseVisible(child);
    };
    traverseVisible(this.group);
    return new Float32Array(verts);
  }

  dispose(): void {
    this.unsubscribeWireframe();
    this.unsubscribePosition();
    this.clearScene();
    this.group.remove(this.handle);
    this.handle.geometry.dispose();

    const canvas = this.viewport.renderer.domElement;
    canvas.removeEventListener('pointerdown', this.onPointerDown);
    canvas.removeEventListener('pointermove', this.onPointerMove);
    canvas.removeEventListener('pointerup',   this.onPointerUp);
    window.removeEventListener('pointerup',   this.onWindowPointerUp);
  }
}
