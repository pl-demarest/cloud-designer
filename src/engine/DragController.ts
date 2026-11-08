import * as THREE from 'three';
import type { Viewport } from './Viewport';

/** One draggable item: a sphere, a base control point, a tail setpoint, a spiral, the flow
 *  cloud or a gizmo anchor. Positions are activeUnitGroup coordinates, as the preset holds them. */
export interface DragTarget {
  /** Where the item is now. */
  position(): readonly [number, number, number];
  /** Moves the item; returns whether the preset changed. */
  moveTo(position: [number, number, number]): boolean;
}

/** A view whose handles can be dragged. */
export interface DragSource {
  /** The handle objects a press can grab. */
  dragHandles(): readonly THREE.Object3D[];
  /** The item behind `handle`, one of this source's dragHandles(). */
  dragTarget(handle: THREE.Object3D): DragTarget;
  /** Its handles give way to any other source's handle under the pointer, nearer or not. */
  readonly yieldsPress?: boolean;
}

/** Called around each drag; C2's history gesture API plugs in here. */
export interface DragHooks {
  onDragStart?: () => void;
  /** `moved`: at least one pointer move reached the preset. */
  onDragEnd?: (moved: boolean) => void;
}

interface ActiveDrag {
  pointerId: number;
  target: DragTarget;
  moved: boolean;
}

/** Whether `obj` and every ancestor are visible; three's raycaster ignores visibility. */
export function isWorldVisible(obj: THREE.Object3D): boolean {
  for (let o: THREE.Object3D | null = obj; o; o = o.parent) {
    if (!o.visible) return false;
  }
  return true;
}

/**
 * The one pointer pipeline for every handle in the viewport. A press raycasts the handles of
 * all registered views in one pass and the nearest world-visible hit wins, except that a source
 * that yields its press (the flow cloud's handle) wins only where no other handle is under the
 * pointer. Only a primary-button press drags; other buttons go to OrbitControls. The drag moves
 * its item on a camera-facing plane through the grab point, keeping the grab offset, with pointer
 * capture and OrbitControls disabled. pointerup (on the canvas or the window), pointercancel,
 * lostpointercapture and a window blur end it and re-enable the controls.
 */
export class DragController {
  private readonly viewport: Viewport;
  private readonly hooks: DragHooks;
  private readonly sources: DragSource[] = [];
  private readonly raycaster = new THREE.Raycaster();
  private readonly pointer = new THREE.Vector2();
  private readonly plane = new THREE.Plane();
  private readonly offset = new THREE.Vector3();
  private drag: ActiveDrag | null = null;

  constructor(viewport: Viewport, hooks: DragHooks = {}) {
    this.viewport = viewport;
    this.hooks = hooks;
    const canvas = viewport.renderer.domElement;
    canvas.addEventListener('pointerdown', this.onPointerDown);
    canvas.addEventListener('pointermove', this.onPointerMove);
    canvas.addEventListener('pointerup', this.onPointerEnd);
    canvas.addEventListener('pointercancel', this.onPointerEnd);
    canvas.addEventListener('lostpointercapture', this.onPointerEnd);
    // A release outside the canvas when capture did not take.
    window.addEventListener('pointerup', this.onPointerEnd);
    // A window that loses the focus mid-drag may never see the release.
    window.addEventListener('blur', this.onBlur);
  }

  /** Adds a view's handles to the pick. */
  register(source: DragSource): void {
    this.sources.push(source);
  }

  /** Whether a drag is in progress. */
  get dragging(): boolean {
    return this.drag !== null;
  }

  /** Ends a drag in progress and removes the listeners. */
  dispose(): void {
    this.endDrag();
    const canvas = this.viewport.renderer.domElement;
    canvas.removeEventListener('pointerdown', this.onPointerDown);
    canvas.removeEventListener('pointermove', this.onPointerMove);
    canvas.removeEventListener('pointerup', this.onPointerEnd);
    canvas.removeEventListener('pointercancel', this.onPointerEnd);
    canvas.removeEventListener('lostpointercapture', this.onPointerEnd);
    window.removeEventListener('pointerup', this.onPointerEnd);
    window.removeEventListener('blur', this.onBlur);
  }

  /** Normalized device coordinates of the event, from the canvas's own rectangle. */
  private aim(e: PointerEvent): void {
    const rect = this.viewport.renderer.domElement.getBoundingClientRect();
    this.pointer.set(
      ((e.clientX - rect.left) / rect.width) * 2 - 1,
      -((e.clientY - rect.top) / rect.height) * 2 + 1,
    );
    this.raycaster.setFromCamera(this.pointer, this.viewport.camera);
  }

  private onPointerDown = (e: PointerEvent): void => {
    if (this.drag || e.button !== 0) return;
    // The press takes the focus from any field now, as the browser does on the mousedown that
    // follows, so a field that records its edit on blur (a number field, the name) records it
    // before a drag's gesture opens, as a step of its own, and before the pick.
    if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
    const owners = new Map<THREE.Object3D, DragSource>();
    for (const source of this.sources) {
      for (const handle of source.dragHandles()) {
        if (isWorldVisible(handle)) owners.set(handle, source);
      }
    }
    if (owners.size === 0) return;
    this.aim(e);
    // Sorted by distance: the nearest handle under the pointer wins, after any that do not yield.
    const hits = this.raycaster.intersectObjects([...owners.keys()], false);
    const hit = hits.find((h) => !owners.get(h.object)!.yieldsPress) ?? hits[0];
    if (!hit) return;

    const target = owners.get(hit.object)!.dragTarget(hit.object);
    const { camera, activeUnitGroup, controls } = this.viewport;
    // Drag plane perpendicular to the camera at the hit point
    const normal = camera.position.clone().sub(hit.point).normalize();
    this.plane.setFromNormalAndCoplanarPoint(normal, hit.point);
    const at = new THREE.Vector3(...target.position());
    this.offset.copy(hit.point).sub(activeUnitGroup.localToWorld(at));

    this.drag = { pointerId: e.pointerId, target, moved: false };
    controls.enabled = false;
    this.viewport.renderer.domElement.setPointerCapture(e.pointerId);
    this.hooks.onDragStart?.();
  };

  private onPointerMove = (e: PointerEvent): void => {
    const drag = this.drag;
    if (!drag || e.pointerId !== drag.pointerId) return;
    this.aim(e);
    const target = new THREE.Vector3();
    // A ray parallel to the plane misses it; the item stays where it is.
    if (!this.raycaster.ray.intersectPlane(this.plane, target)) return;
    target.sub(this.offset);
    this.viewport.activeUnitGroup.worldToLocal(target);
    if (drag.target.moveTo([target.x, target.y, target.z])) drag.moved = true;
  };

  private onPointerEnd = (e: PointerEvent): void => {
    if (this.drag && e.pointerId === this.drag.pointerId) this.endDrag();
  };

  private onBlur = (): void => this.endDrag();

  private endDrag(): void {
    const drag = this.drag;
    if (!drag) return;
    this.drag = null;
    this.viewport.controls.enabled = true;
    const canvas = this.viewport.renderer.domElement;
    if (canvas.hasPointerCapture?.(drag.pointerId)) canvas.releasePointerCapture(drag.pointerId);
    this.hooks.onDragEnd?.(drag.moved);
  }
}
