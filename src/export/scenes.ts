import * as THREE from 'three';

/**
 * The scenes the GLB exports write, built from copies of the editor's groups. Nothing flagged
 * userData.editorOnly is copied: drag handles, the axis gizmo, the grid and axes helpers.
 */

/** The editor's groups the exports copy (EditorEngine.scaffoldGroups and the flow-cloud group). */
export interface ExportSources {
  spheres: THREE.Group;
  base: THREE.Group;
  tail: THREE.Group;
  spirals: THREE.Group;
  flowCloud: THREE.Group;
}

/**
 * A copy of `object` and its descendants without anything flagged userData.editorOnly, or null
 * when `object` is flagged. Geometries and materials are shared with the original (as
 * Object3D.clone shares them), so the copy must not dispose them.
 */
export function cloneExportable(object: THREE.Object3D): THREE.Object3D | null {
  if (object.userData.editorOnly === true) return null;
  const copy = object.clone(false);
  for (const child of object.children) {
    const childCopy = cloneExportable(child);
    if (childCopy) copy.add(childCopy);
  }
  return copy;
}

/**
 * A group named `name` with the exportable copies of `source`'s children, at `source`'s
 * transform. The group is visible whatever `source` is (Preview hides the scaffold groups);
 * each copy keeps its own visibility, and GLTFExporter leaves out what is hidden (for example
 * the bands when Show Bands is off).
 */
export function exportPart(name: string, source: THREE.Object3D): THREE.Group {
  const part = new THREE.Group();
  part.name = name;
  part.position.copy(source.position);
  part.quaternion.copy(source.quaternion);
  part.scale.copy(source.scale);
  for (const child of source.children) {
    const copy = cloneExportable(child);
    if (copy) part.add(copy);
  }
  return part;
}

function group(name: string, children: THREE.Object3D[]): THREE.Group {
  const g = new THREE.Group();
  g.name = name;
  if (children.length > 0) g.add(...children);
  return g;
}

const hasContent = (part: THREE.Object3D) => part.children.length > 0;

/** 'scaffold': the 'spheres' and 'base' parts; null when both are empty. */
export function scaffoldScene(src: ExportSources): THREE.Group | null {
  const parts = [exportPart('spheres', src.spheres), exportPart('base', src.base)];
  return parts.some(hasContent) ? group('scaffold', parts) : null;
}

/** 'cloud-wireframe': the flow cloud as 'body', then 'tail' and 'spirals' when they have
 *  content; null without a generated flow cloud. */
export function wireframeScene(src: ExportSources): THREE.Group | null {
  const body = exportPart('body', src.flowCloud);
  if (!hasContent(body)) return null;
  const extras = [exportPart('tail', src.tail), exportPart('spirals', src.spirals)].filter(hasContent);
  return group('cloud-wireframe', [body, ...extras]);
}

/** 'cloud': the scaffold (spheres and base) and the flow cloud as 'wireframe', each when it has
 *  content; null when neither has. */
export function fullScene(src: ExportSources): THREE.Group | null {
  const scaffold = scaffoldScene(src);
  const rest = [exportPart('wireframe', src.flowCloud)].filter(hasContent);
  const children = scaffold ? [scaffold, ...rest] : rest;
  return children.length > 0 ? group('cloud', children) : null;
}

/**
 * The Cloud GLB, githubLanding's input: a root group named 'cloud' holding exactly one
 * THREE.LineSegments (glTF mode LINES) of the Cut & Glue edges, and nothing else. githubLanding's
 * loadCloudLayer (src/scene/CloudLayer.ts there) merges a file's line primitives into one edge
 * buffer and draws it as LineSegments; the wireframe and full exports carry the flow lines as
 * THREE.Line (glTF LINE_STRIP), which it converts to segment pairs. tests/e2e/export.spec.ts
 * loads this file with GLTFLoader and pins its node types. dispose() frees the geometry and
 * material made here once the file is written.
 */
export function cloudScene(edges: Float32Array): { scene: THREE.Group; dispose: () => void } {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(edges, 3));
  const material = new THREE.LineBasicMaterial({ color: 0x000000 });
  const scene = group('cloud', [new THREE.LineSegments(geometry, material)]);
  return {
    scene,
    dispose: () => {
      geometry.dispose();
      material.dispose();
    },
  };
}
