import * as THREE from 'three';
import type { SpiralDef } from '../../model/types';
import { Viewport } from '../Viewport';
import { useCloudStore } from '../../store/cloudStore';
import { KeyedMeshSet } from '../KeyedMeshSet';
import { sameValue } from '../sameValue';
import type { DragSource, DragTarget } from '../DragController';
import { sampleSpiral, spiralWire } from '../../geometry/primitives/spiral';
import { RANGES } from '../../model/ranges';

interface SpiralEntry {
  wire: THREE.LineSegments;
  handle: THREE.Mesh;
  objects: readonly THREE.Object3D[];
  /** The definition the objects show. */
  def: SpiralDef;
}

export class SpiralMesh implements DragSource {
  private group: THREE.Group;
  private viewport: Viewport;
  private meshes: KeyedMeshSet<SpiralDef, SpiralEntry>;
  private unsubscribe: () => void;

  constructor(viewport: Viewport) {
    this.viewport = viewport;
    this.group = viewport.spiralGroup;
    this.meshes = new KeyedMeshSet(this.group, {
      create: (def) => this.createMesh(def),
      update: (entry, def) => this.updateMesh(entry, def),
    });

    this.unsubscribe = useCloudStore.subscribe(
      (s) => s.preset.spirals,
      (spirals) => this.sync(spirals)
    );
    this.sync(useCloudStore.getState().preset.spirals);
  }

  /** Call with false in preview mode to hide handles while keeping spiral geometry visible. */
  setHandlesVisible(visible: boolean): void {
    for (const { handle } of this.meshes.values()) {
      handle.visible = visible;
    }
  }

  private sync(spirals: SpiralDef[]): void {
    this.meshes.sync(spirals);
  }

  private createMesh(def: SpiralDef): SpiralEntry {
    const { materials } = this.viewport;
    const wire = new THREE.LineSegments(this.buildGeo(def), materials.line);
    wire.userData.spiralId = def.id;

    const handleGeo = new THREE.BoxGeometry(0.2, 0.2, 0.2);
    const handle = new THREE.Mesh(handleGeo, materials.spiralHandle);
    handle.position.set(...def.position);
    handle.userData.spiralId = def.id;
    handle.userData.editorOnly = true;

    return { wire, handle, objects: [wire, handle], def };
  }

  /** Rebuilds the wire when the definition changed: position and rotation are baked into it. */
  private updateMesh(entry: SpiralEntry, def: SpiralDef): void {
    if (sameValue(entry.def, def)) return;
    entry.def = def;
    entry.wire.geometry.dispose();
    entry.wire.geometry = this.buildGeo(def);
    entry.handle.position.set(...def.position);
  }

  /** The wire spiralWire builds from the kernel's samples (src/geometry/primitives/spiral.ts),
   *  flat or thick; no position attribute for a spiral of no turns. */
  private buildGeo(def: SpiralDef): THREE.BufferGeometry {
    const geo = new THREE.BufferGeometry();
    const samples = sampleSpiral(def);
    if (samples.length === 0) return geo;
    geo.setAttribute('position', new THREE.Float32BufferAttribute(spiralWire(def, samples), 3));
    return geo;
  }

  // ── Dragging (DragController) ───────────────────────────────────────────────

  dragHandles(): THREE.Object3D[] {
    return Array.from(this.meshes.values(), (entry) => entry.handle);
  }

  dragTarget(handle: THREE.Object3D): DragTarget {
    const id = handle.userData.spiralId as string;
    return {
      position: () => useCloudStore.getState().preset.spirals.find((s) => s.id === id)!.position,
      range: RANGES.spiral.position,
      moveTo: (position) => {
        useCloudStore.getState().updateSpiral(id, { position });
        return true;
      },
    };
  }

  getEdges(): Float32Array {
    const verts: number[] = [];
    const v = new THREE.Vector3();
    this.group.traverse((obj) => {
      if ((obj instanceof THREE.LineSegments || obj instanceof THREE.Line) && !obj.userData.editorOnly) {
        obj.updateWorldMatrix(true, false);
        const pos = obj.geometry.attributes.position;
        if (!pos) return;
        for (let i = 0; i < pos.count; i++) {
          v.fromBufferAttribute(pos, i).applyMatrix4(obj.matrixWorld);
          verts.push(v.x, v.y, v.z);
        }
      }
    });
    return new Float32Array(verts);
  }

  /** Per-spiral edge groups for Cut & Glue self-exclusion (analogous to SphereMesh.getEdgesGrouped). */
  getEdgesGrouped(): Array<{ spiralId: string; edges: Float32Array }> {
    const result: Array<{ spiralId: string; edges: Float32Array }> = [];
    const v = new THREE.Vector3();
    for (const [id, { wire }] of this.meshes) {
      const verts: number[] = [];
      wire.updateWorldMatrix(true, false);
      const pos = wire.geometry.attributes.position;
      if (pos) {
        for (let i = 0; i < pos.count; i++) {
          v.fromBufferAttribute(pos, i).applyMatrix4(wire.matrixWorld);
          verts.push(v.x, v.y, v.z);
        }
      }
      result.push({ spiralId: id, edges: new Float32Array(verts) });
    }
    return result;
  }

  dispose(): void {
    this.unsubscribe();
    this.meshes.clear();
  }
}
