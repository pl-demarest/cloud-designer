import type { Object3D } from 'three';

/**
 * `scene` as a binary glTF (GLB) file. GLTFExporter is imported on first use, so it is a chunk
 * of its own that the editor downloads only when something is exported.
 */
export async function writeGlb(scene: Object3D): Promise<ArrayBuffer> {
  const { GLTFExporter } = await import('three/addons/exporters/GLTFExporter.js');
  const result = await new GLTFExporter().parseAsync(scene, { binary: true });
  if (!(result instanceof ArrayBuffer)) throw new Error('GLTFExporter returned JSON for a binary export');
  return result;
}
