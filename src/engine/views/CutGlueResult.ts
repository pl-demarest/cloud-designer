import * as THREE from 'three';
import { Viewport } from '../Viewport';
import { disposeMaterial } from '../dispose';

const MAT = new THREE.LineBasicMaterial({ color: 0x000000 });

export class CutGlueResult {
  private group: THREE.Group;
  private lines: THREE.LineSegments | null = null;
  private surfaceWire: THREE.LineSegments | null = null;
  private edgesBuffer: Float32Array = new Float32Array(0);

  constructor(viewport: Viewport) {
    this.group = viewport.cutGlueGroup;
  }

  /** Update the clipped edge wireframe (from Cut & Glue worker). */
  update(edges: Float32Array): void {
    // Clean up existing edge geometry
    if (this.lines) {
      this.group.remove(this.lines);
      this.lines.geometry.dispose();
      this.lines = null;
    }

    this.edgesBuffer = edges;
    if (edges.length > 0) {
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.BufferAttribute(edges, 3));
      this.lines = new THREE.LineSegments(geo, MAT.clone());
      this.group.add(this.lines);
    }
  }

  /** Update the unified surface mesh wireframe (from surface mesh worker). */
  updateSurfaceMesh(positions: Float32Array, indices: Uint32Array): void {
    if (this.surfaceWire) {
      this.group.remove(this.surfaceWire);
      this.surfaceWire.geometry.dispose();
      this.surfaceWire = null;
    }

    if (positions.length > 0) {
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
      geo.setIndex(new THREE.BufferAttribute(indices, 1));
      const wireGeo = new THREE.WireframeGeometry(geo);
      this.surfaceWire = new THREE.LineSegments(wireGeo, MAT.clone());
      this.surfaceWire.visible = false; // toggled by user
      this.group.add(this.surfaceWire);
      geo.dispose();
    }
  }

  setVisible(v: boolean): void {
    this.group.visible = v;
  }

  setSurfaceMeshVisible(v: boolean): void {
    if (this.surfaceWire) this.surfaceWire.visible = v;
    if (this.lines) this.lines.visible = !v;
  }

  hasSurfaceMesh(): boolean {
    return this.surfaceWire !== null;
  }

  getEdges(): Float32Array {
    return this.edgesBuffer;
  }

  dispose(): void {
    for (const obj of [this.lines, this.surfaceWire]) {
      if (!obj) continue;
      this.group.remove(obj);
      obj.geometry.dispose();
      // Each result's material is its own clone.
      disposeMaterial(obj.material);
    }
    this.lines = null;
    this.surfaceWire = null;
    this.edgesBuffer = new Float32Array(0);
  }
}
