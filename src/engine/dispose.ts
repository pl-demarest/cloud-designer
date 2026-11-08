import type * as THREE from 'three';

/** Disposes a material, or each of an object's materials. */
export function disposeMaterial(material: THREE.Material | THREE.Material[]): void {
  if (Array.isArray(material)) for (const m of material) m.dispose();
  else material.dispose();
}
