import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { createEditorMaterials, disposeEditorMaterials, type EditorMaterials } from './materials';

/** Creates the renderer for a canvas; tests pass one that needs no WebGL. */
export type RendererFactory = (canvas: HTMLCanvasElement) => THREE.WebGLRenderer;

export const createWebGLRenderer: RendererFactory = (canvas) =>
  new THREE.WebGLRenderer({ canvas, antialias: true });

/** Above this the extra pixels cost fill rate on the dense wireframes and show no detail. */
const MAX_PIXEL_RATIO = 2;

/**
 * The layer of the thick spirals' wires. The camera sees it in Edit; in Preview the surface mesh
 * holds the thick spirals, and only the flat ones are drawn beside it. A layer, not `visible`, so
 * the GLB exports, which copy visibility, keep every spiral.
 */
export const THICK_SPIRAL_LAYER = 1;

/** After Fit the camera looks at the framed centre from above and in front, as it always has. */
const FIT_DIRECTION = new THREE.Vector3(0, 0.4, 1.4).normalize();

/**
 * Whether `obj` or an ancestor carries userData.editorOnly: every handle, the axis gizmo and the
 * grid and axes helpers, drawn for editing and not part of the cloud.
 */
export function isEditorOnly(obj: THREE.Object3D): boolean {
  for (let o: THREE.Object3D | null = obj; o; o = o.parent) {
    if (o.userData.editorOnly === true) return true;
  }
  return false;
}

export class Viewport {
  renderer: THREE.WebGLRenderer;
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  controls: OrbitControls;

  /** Parent group for all live editing modules. Always at world origin. */
  activeUnitGroup: THREE.Group;
  sphereGroup: THREE.Group;
  baseGroup: THREE.Group;
  tailGroup: THREE.Group;
  spiralGroup: THREE.Group;
  flowCloudGroup: THREE.Group;
  gizmoGroup: THREE.Group;
  /** Cut & Glue output — shown in Preview mode only. NOT inside activeUnitGroup. */
  cutGlueGroup: THREE.Group;
  /** The materials every view draws with, disposed with the viewport. */
  readonly materials: EditorMaterials = createEditorMaterials();

  private grid: THREE.GridHelper;
  private axes: THREE.AxesHelper;
  private lights: THREE.Light[];
  /** The pixel ratio the renderer draws at (applyPixelRatio). */
  private pixelRatio = 0;

  constructor(canvas: HTMLCanvasElement, createRenderer: RendererFactory = createWebGLRenderer) {
    this.renderer = createRenderer(canvas);
    this.applyPixelRatio();
    this.renderer.setClearColor(0xffffff);

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0xffffff);

    this.camera = new THREE.PerspectiveCamera(50, 1, 0.01, 1000);
    this.camera.position.set(0, 4, 10);
    this.camera.lookAt(0, 0, 0);

    this.controls = new OrbitControls(this.camera, canvas);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.05;

    // Lighting (subtle for wireframe look)
    const ambient = new THREE.AmbientLight(0xffffff, 0.8);
    this.scene.add(ambient);
    const dir = new THREE.DirectionalLight(0xffffff, 0.4);
    dir.position.set(5, 10, 7);
    this.scene.add(dir);
    this.lights = [ambient, dir];

    // Grid helper
    const grid = new THREE.GridHelper(20, 20, 0xcccccc, 0xeeeeee);
    grid.position.y = -1;
    grid.userData.editorOnly = true;
    this.scene.add(grid);
    this.grid = grid;

    // Axes helper (small, toggleable via showAxes)
    const axes = new THREE.AxesHelper(1);
    axes.name = 'axesHelper';
    axes.userData.editorOnly = true;
    this.scene.add(axes);
    this.axes = axes;

    // Active-unit parent — all editing groups live here so a single transform
    // moves/scales the whole unit without touching preset values.
    this.activeUnitGroup = new THREE.Group();
    this.activeUnitGroup.name = 'activeUnitGroup';
    this.scene.add(this.activeUnitGroup);

    this.sphereGroup = new THREE.Group();
    this.sphereGroup.name = 'sphereGroup';
    this.activeUnitGroup.add(this.sphereGroup);

    this.baseGroup = new THREE.Group();
    this.baseGroup.name = 'baseGroup';
    this.activeUnitGroup.add(this.baseGroup);

    this.tailGroup = new THREE.Group();
    this.tailGroup.name = 'tailGroup';
    this.activeUnitGroup.add(this.tailGroup);

    this.spiralGroup = new THREE.Group();
    this.spiralGroup.name = 'spiralGroup';
    this.activeUnitGroup.add(this.spiralGroup);

    this.flowCloudGroup = new THREE.Group();
    this.flowCloudGroup.name = 'flowCloudGroup';
    this.activeUnitGroup.add(this.flowCloudGroup);

    this.gizmoGroup = new THREE.Group();
    this.gizmoGroup.name = 'gizmoGroup';
    this.gizmoGroup.userData.editorOnly = true;
    this.activeUnitGroup.add(this.gizmoGroup);

    // Cut & Glue output lives directly on the scene (not inside activeUnitGroup)
    this.cutGlueGroup = new THREE.Group();
    this.cutGlueGroup.name = 'cutGlueGroup';
    this.cutGlueGroup.visible = false;
    this.scene.add(this.cutGlueGroup);
  }

  /**
   * Starts the render loop; calling it again replaces the loop rather than adding one. Each frame
   * first applies a devicePixelRatio that changed without a resize, as when the window moves to a
   * display with another ratio and keeps its size.
   */
  start(): void {
    this.renderer.setAnimationLoop(() => {
      if (Math.min(window.devicePixelRatio, MAX_PIXEL_RATIO) !== this.pixelRatio) this.applyPixelRatio();
      this.controls.update();
      this.renderer.render(this.scene, this.camera);
    });
  }

  stop(): void {
    this.renderer.setAnimationLoop(null);
  }

  /** Draws at the window's devicePixelRatio, capped at MAX_PIXEL_RATIO; three's setPixelRatio
   *  sizes the drawing buffer again for it. */
  private applyPixelRatio(): void {
    this.pixelRatio = Math.min(window.devicePixelRatio, MAX_PIXEL_RATIO);
    this.renderer.setPixelRatio(this.pixelRatio);
  }

  /** Sizes the drawing buffer to the canvas's CSS size (EditorEngine's ResizeObserver calls it).
   *  The pixel ratio is read again, since the window may have moved to another display. A zero
   *  size (a collapsed parent) is ignored rather than giving the camera an infinite aspect. */
  resize(width: number, height: number): void {
    if (width === 0 || height === 0) return;
    this.applyPixelRatio();
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(width, height, false);
  }

  showAxes(visible: boolean): void {
    this.axes.visible = visible;
  }

  showGrid(visible: boolean): void {
    this.grid.visible = visible;
  }

  /** Whether the camera draws the thick spirals' wires (THICK_SPIRAL_LAYER). */
  showThickSpirals(visible: boolean): void {
    if (visible) this.camera.layers.enable(THICK_SPIRAL_LAYER);
    else this.camera.layers.disable(THICK_SPIRAL_LAYER);
  }

  /**
   * Frames `box`, or else what the viewport shows: the visible objects under the active unit and
   * the Cut & Glue group (in Preview, the result), without handles or the gizmo. The bounding
   * sphere fits within the smaller of the horizontal and vertical fields of view. Nothing to
   * frame leaves the camera where it is.
   */
  zoomToFit(box?: THREE.Box3): void {
    const target = box ?? this.visibleContentBox();
    if (target.isEmpty()) return;
    const sphere = target.getBoundingSphere(new THREE.Sphere());
    const vFov = THREE.MathUtils.degToRad(this.camera.fov);
    const hFov = 2 * Math.atan(Math.tan(vFov / 2) * this.camera.aspect);
    const dist = sphere.radius / Math.sin(Math.min(vFov, hFov) / 2);
    this.camera.position.copy(sphere.center).addScaledVector(FIT_DIRECTION, dist);
    this.controls.target.copy(sphere.center);
    this.controls.update();
  }

  /** The world box of every visible, not editor-only object with geometry on a layer the camera
   *  draws. */
  private visibleContentBox(): THREE.Box3 {
    const box = new THREE.Box3();
    const part = new THREE.Box3();
    for (const root of [this.activeUnitGroup, this.cutGlueGroup]) {
      root.updateWorldMatrix(true, true);
      // traverseVisible skips hidden subtrees; both roots hang off the always-visible scene.
      root.traverseVisible((obj) => {
        if (!(obj instanceof THREE.Mesh || obj instanceof THREE.Line || obj instanceof THREE.Points)) return;
        if (isEditorOnly(obj) || !obj.layers.test(this.camera.layers)) return;
        const geometry = obj.geometry;
        if (!geometry.getAttribute('position')) return;
        if (!geometry.boundingBox) geometry.computeBoundingBox();
        box.union(part.copy(geometry.boundingBox!).applyMatrix4(obj.matrixWorld));
      });
    }
    return box;
  }

  /**
   * Stops the loop and releases what the constructor created: listeners, the grid and axes
   * helpers, the lights, the shared materials and the renderer. The views dispose their own
   * objects first (EditorEngine.dispose).
   */
  dispose(): void {
    this.stop();
    this.controls.dispose();
    this.grid.dispose();
    this.axes.dispose();
    for (const light of this.lights) light.dispose();
    disposeEditorMaterials(this.materials);
    this.scene.clear();
    // A renderer made later on this canvas (React StrictMode's remount) gets the same WebGL
    // context and creates its empty 3D textures assuming WebGL's default unpack state. The gizmo's
    // label upload left UNPACK_FLIP_Y_WEBGL set, which made those uploads fail.
    const gl = this.renderer.getContext();
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
    this.renderer.dispose();
  }
}
