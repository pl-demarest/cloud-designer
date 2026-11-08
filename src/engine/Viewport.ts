import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

/** Creates the renderer for a canvas; tests pass one that needs no WebGL. */
export type RendererFactory = (canvas: HTMLCanvasElement) => THREE.WebGLRenderer;

export const createWebGLRenderer: RendererFactory = (canvas) =>
  new THREE.WebGLRenderer({ canvas, antialias: true });

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

  private tickCallbacks: Array<(dt: number) => void> = [];
  private timer = new THREE.Timer();
  private _claimedDrag = false;
  private grid: THREE.GridHelper;
  private axes: THREE.AxesHelper;
  private lights: THREE.Light[];

  constructor(canvas: HTMLCanvasElement, createRenderer: RendererFactory = createWebGLRenderer) {
    this.renderer = createRenderer(canvas);
    this.renderer.setPixelRatio(window.devicePixelRatio);
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
    this.scene.add(grid);
    this.grid = grid;

    // Axes helper (small, toggleable via showAxes)
    const axes = new THREE.AxesHelper(1);
    axes.name = 'axesHelper';
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
    this.activeUnitGroup.add(this.gizmoGroup);

    // Cut & Glue output lives directly on the scene (not inside activeUnitGroup)
    this.cutGlueGroup = new THREE.Group();
    this.cutGlueGroup.name = 'cutGlueGroup';
    this.cutGlueGroup.visible = false;
    this.scene.add(this.cutGlueGroup);

    window.addEventListener('resize', this.handleResize);
  }

  /**
   * Called by a drag-handling module when it finds a hit and wants to start a drag.
   * Returns true if the drag was successfully claimed (no other module is dragging).
   * Returns false if another module already owns the current drag — caller should bail out.
   */
  claimDrag(): boolean {
    if (this._claimedDrag) return false;
    this._claimedDrag = true;
    return true;
  }

  /** Called by a drag-handling module when its drag ends (pointerup or window pointerup). */
  releaseDrag(): void {
    this._claimedDrag = false;
  }

  onTick(cb: (dt: number) => void): void {
    this.tickCallbacks.push(cb);
  }

  /** Starts the render loop; calling it again replaces the loop rather than adding one. */
  start(): void {
    this.timer.reset();
    this.renderer.setAnimationLoop((time) => {
      this.timer.update(time);
      const dt = this.timer.getDelta();
      this.controls.update();
      this.tickCallbacks.forEach((cb) => cb(dt));
      this.renderer.render(this.scene, this.camera);
    });
  }

  stop(): void {
    this.renderer.setAnimationLoop(null);
  }

  resize(width: number, height: number): void {
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

  zoomToFit(box?: THREE.Box3): void {
    const target = box ?? new THREE.Box3().setFromObject(this.flowCloudGroup.children.length > 0 ? this.flowCloudGroup : this.sphereGroup);
    if (target.isEmpty()) return;
    const center = target.getCenter(new THREE.Vector3());
    const size = target.getSize(new THREE.Vector3());
    const maxDim = Math.max(size.x, size.y, size.z);
    const dist = maxDim / (2 * Math.tan((this.camera.fov * Math.PI) / 360));
    this.camera.position.copy(center).add(new THREE.Vector3(0, dist * 0.4, dist * 1.4));
    this.controls.target.copy(center);
    this.controls.update();
  }

  private handleResize = (): void => {
    const canvas = this.renderer.domElement;
    const parent = canvas.parentElement;
    if (!parent) return;
    this.resize(parent.clientWidth, parent.clientHeight);
  };

  /**
   * Stops the loop and releases what the constructor created: listeners, the grid and axes
   * helpers, the lights and the renderer. The views dispose their own objects first
   * (EditorEngine.dispose).
   */
  dispose(): void {
    this.stop();
    this.timer.dispose();
    this.tickCallbacks = [];
    window.removeEventListener('resize', this.handleResize);
    this.controls.dispose();
    this.grid.dispose();
    this.axes.dispose();
    for (const light of this.lights) light.dispose();
    this.scene.clear();
    this.renderer.dispose();
  }
}
