import * as THREE from 'three';

/**
 * The editor's materials: one per role, shared by every object in that role, so no view clones
 * a material per object. The Viewport creates one set and disposes it before its renderer.
 */
export interface EditorMaterials {
  /** Black lines: every primitive's wireframe, the flow cloud and the Cut & Glue result. */
  readonly line: THREE.LineBasicMaterial;
  readonly sphereHandle: THREE.MeshBasicMaterial;
  readonly baseHandle: THREE.MeshBasicMaterial;
  readonly tailHandle: THREE.MeshBasicMaterial;
  readonly spiralHandle: THREE.MeshBasicMaterial;
  readonly flowCloudHandle: THREE.MeshBasicMaterial;
  /** The axis gizmo's F and B anchors, drawn over everything. */
  readonly gizmoFront: THREE.MeshBasicMaterial;
  readonly gizmoBack: THREE.MeshBasicMaterial;
}

export function createEditorMaterials(): EditorMaterials {
  return {
    line: new THREE.LineBasicMaterial({ color: 0x000000 }),
    sphereHandle: new THREE.MeshBasicMaterial({ color: 0x2563eb }), // blue
    baseHandle: new THREE.MeshBasicMaterial({ color: 0x16a34a }), // green
    tailHandle: new THREE.MeshBasicMaterial({ color: 0xdc2626 }), // red
    spiralHandle: new THREE.MeshBasicMaterial({ color: 0xf97316 }), // orange
    flowCloudHandle: new THREE.MeshBasicMaterial({ color: 0x06b6d4 }), // teal
    gizmoFront: new THREE.MeshBasicMaterial({ color: 0x2563eb, depthTest: false }),
    gizmoBack: new THREE.MeshBasicMaterial({ color: 0xdc2626, depthTest: false }),
  };
}

export function disposeEditorMaterials(materials: EditorMaterials): void {
  for (const material of Object.values(materials)) material.dispose();
}
