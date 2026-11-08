/** The view state that decides what the viewport shows (src/store/uiStore.ts holds it). */
export interface ViewFlags {
  mode: 'edit' | 'preview';
  showAxes: boolean;
  showGrid: boolean;
  /** Show/Hide for the flow cloud. */
  showFlowCloud: boolean;
  /** The Surface Mesh checkbox: the Cut & Glue result shows the surface mesh instead of the
   *  clipped wireframe. */
  surfaceMeshVisible: boolean;
}

export interface VisibilityInputs extends ViewFlags {
  /** Some spiral is flat (thickness 0); the surface mesh holds only thick ones. */
  hasFlatSpirals: boolean;
}

/** What each part of the viewport shows. */
export interface Visibility {
  axes: boolean;
  grid: boolean;
  spheres: boolean;
  base: boolean;
  tail: boolean;
  spirals: boolean;
  /** Within the spirals: the thick ones' wires too (Edit), or the flat ones' only (Preview,
   *  beside the surface mesh, which holds the thick ones). */
  thickSpirals: boolean;
  spiralHandles: boolean;
  gizmo: boolean;
  flowCloud: boolean;
  /** The flow cloud's drag handle, once a flow cloud has been generated. */
  flowCloudHandle: boolean;
  cutGlue: boolean;
  /** Within the Cut & Glue result: the surface mesh (true) or the clipped wireframe (false). */
  cutGlueSurfaceMesh: boolean;
}

/**
 * Edit shows the scaffold, its handles and the flow cloud (unless Show/Hide hides it); Preview
 * shows the Cut & Glue result and, beside the surface mesh, the flat spirals it cannot hold.
 * The mode and Show/Hide combine here instead of each overwriting the other's visibility.
 */
export function computeVisibility(v: VisibilityInputs): Visibility {
  const edit = v.mode === 'edit';
  return {
    axes: v.showAxes,
    grid: v.showGrid,
    spheres: edit,
    base: edit,
    tail: edit,
    spirals: edit || (v.surfaceMeshVisible && v.hasFlatSpirals),
    thickSpirals: edit,
    spiralHandles: edit,
    gizmo: edit,
    flowCloud: edit && v.showFlowCloud,
    flowCloudHandle: edit,
    cutGlue: !edit,
    cutGlueSurfaceMesh: v.surfaceMeshVisible,
  };
}
