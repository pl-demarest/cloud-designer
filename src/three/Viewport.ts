import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

export class Viewport {
  renderer: THREE.WebGLRenderer;
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  controls: OrbitControls;

  swirlGroup: THREE.Group;
  baseGroup: THREE.Group;
  tailGroup: THREE.Group;
  mergeGroup: THREE.Group;
  gizmoGroup: THREE.Group;

  private animFrameId: number | null = null;
  private tickCallbacks: Array<(dt: number) => void> = [];
  private clock = new THREE.Clock();

  constructor(canvas: HTMLCanvasElement) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
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
    this.scene.add(new THREE.AmbientLight(0xffffff, 0.8));
    const dir = new THREE.DirectionalLight(0xffffff, 0.4);
    dir.position.set(5, 10, 7);
    this.scene.add(dir);

    // Grid helper
    const grid = new THREE.GridHelper(20, 20, 0xcccccc, 0xeeeeee);
    grid.position.y = -1;
    this.scene.add(grid);

    // Axes helper (small, toggleable via showAxes)
    const axes = new THREE.AxesHelper(1);
    axes.name = 'axesHelper';
    this.scene.add(axes);

    // Scene groups
    this.swirlGroup = new THREE.Group();
    this.swirlGroup.name = 'swirlGroup';
    this.scene.add(this.swirlGroup);

    this.baseGroup = new THREE.Group();
    this.baseGroup.name = 'baseGroup';
    this.scene.add(this.baseGroup);

    this.tailGroup = new THREE.Group();
    this.tailGroup.name = 'tailGroup';
    this.scene.add(this.tailGroup);

    this.mergeGroup = new THREE.Group();
    this.mergeGroup.name = 'mergeGroup';
    this.scene.add(this.mergeGroup);

    this.gizmoGroup = new THREE.Group();
    this.gizmoGroup.name = 'gizmoGroup';
    this.scene.add(this.gizmoGroup);

    window.addEventListener('resize', this.handleResize);
  }

  onTick(cb: (dt: number) => void): void {
    this.tickCallbacks.push(cb);
  }

  start(): void {
    this.clock.start();
    const loop = () => {
      this.animFrameId = requestAnimationFrame(loop);
      const dt = this.clock.getDelta();
      this.controls.update();
      this.tickCallbacks.forEach((cb) => cb(dt));
      this.renderer.render(this.scene, this.camera);
    };
    loop();
  }

  stop(): void {
    if (this.animFrameId !== null) {
      cancelAnimationFrame(this.animFrameId);
      this.animFrameId = null;
    }
  }

  resize(width: number, height: number): void {
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(width, height, false);
  }

  showAxes(visible: boolean): void {
    const axes = this.scene.getObjectByName('axesHelper');
    if (axes) axes.visible = visible;
  }

  showGrid(visible: boolean): void {
    this.scene.children.forEach((child) => {
      if (child instanceof THREE.GridHelper) child.visible = visible;
    });
  }

  zoomToFit(box?: THREE.Box3): void {
    const target = box ?? new THREE.Box3().setFromObject(this.mergeGroup.children.length > 0 ? this.mergeGroup : this.swirlGroup);
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

  dispose(): void {
    this.stop();
    window.removeEventListener('resize', this.handleResize);
    this.controls.dispose();
    this.renderer.dispose();
  }
}
