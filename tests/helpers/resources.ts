import * as THREE from 'three'

/**
 * Counts the geometries, materials and textures three.js creates and disposes, with no renderer.
 *
 * Each base constructor marks its instance with a plain assignment (BufferGeometry:
 * `this.isBufferGeometry = true`, Material: `this.isMaterial = true`, Texture:
 * `this.isTexture = true`, three r183). While tracking, an accessor of that name on the base
 * prototype receives the assignment, so every instance is seen as it is constructed, subclasses
 * and clones included; dispose() is wrapped on the same prototypes. Only objects created while
 * tracking count: module-level constants made at import time are left out.
 */

export interface ResourceCounts {
  geometries: number
  materials: number
  textures: number
}

type Kind = keyof ResourceCounts

interface Disposable {
  dispose(): void
}

const KINDS: ReadonlyArray<readonly [Kind, Disposable, string]> = [
  ['geometries', THREE.BufferGeometry.prototype, 'isBufferGeometry'],
  ['materials', THREE.Material.prototype, 'isMaterial'],
  ['textures', THREE.Texture.prototype, 'isTexture'],
]

export interface ResourceTracker {
  /** Objects created since tracking began. */
  created(): ResourceCounts
  /** Of those, the ones disposed. */
  disposed(): ResourceCounts
  /** Created and not disposed. */
  live(): ResourceCounts
  /** Removes the hooks; counts stay readable. */
  stop(): void
}

export function trackResources(): ResourceTracker {
  const created: Record<Kind, Set<object>> = { geometries: new Set(), materials: new Set(), textures: new Set() }
  const disposed: Record<Kind, Set<object>> = { geometries: new Set(), materials: new Set(), textures: new Set() }
  const restore: Array<() => void> = []

  for (const [kind, proto, flag] of KINDS) {
    Object.defineProperty(proto, flag, {
      configurable: true,
      get: () => undefined,
      set(this: object, value: unknown) {
        Object.defineProperty(this, flag, { value, writable: true, enumerable: true, configurable: true })
        created[kind].add(this)
      },
    })
    const dispose = proto.dispose
    proto.dispose = function (this: object) {
      if (created[kind].has(this)) disposed[kind].add(this)
      return dispose.call(this)
    }
    restore.push(() => {
      delete (proto as unknown as Record<string, unknown>)[flag]
      proto.dispose = dispose
    })
  }

  const counts = (sets: Record<Kind, Set<object>>): ResourceCounts => ({
    geometries: sets.geometries.size,
    materials: sets.materials.size,
    textures: sets.textures.size,
  })

  return {
    created: () => counts(created),
    disposed: () => counts(disposed),
    live: () => {
      const c = counts(created)
      const d = counts(disposed)
      return { geometries: c.geometries - d.geometries, materials: c.materials - d.materials, textures: c.textures - d.textures }
    },
    stop: () => {
      while (restore.length > 0) restore.pop()!()
    },
  }
}

/**
 * Records addEventListener and removeEventListener calls on the named targets and reports the
 * listeners still attached, as "name:type" strings (sorted), counting each (type, listener,
 * capture) triple once, as the DOM does.
 */
export interface ListenerTracker {
  active(): string[]
  stop(): void
}

export function trackListeners(targets: Record<string, EventTarget>): ListenerTracker {
  interface Entry {
    name: string
    type: string
    listener: unknown
    capture: boolean
  }
  const entries: Entry[] = []
  const restore: Array<() => void> = []
  const captureOf = (options?: boolean | EventListenerOptions) =>
    typeof options === 'boolean' ? options : Boolean(options?.capture)

  for (const [name, target] of Object.entries(targets)) {
    const own = {
      add: Object.getOwnPropertyDescriptor(target, 'addEventListener'),
      remove: Object.getOwnPropertyDescriptor(target, 'removeEventListener'),
    }
    const add = target.addEventListener
    const remove = target.removeEventListener
    const find = (type: string, listener: unknown, capture: boolean) =>
      entries.findIndex((e) => e.name === name && e.type === type && e.listener === listener && e.capture === capture)
    target.addEventListener = function (this: EventTarget, type, listener, options) {
      const capture = captureOf(options)
      if (listener && find(type, listener, capture) < 0) entries.push({ name, type, listener, capture })
      return add.call(this, type, listener, options)
    }
    target.removeEventListener = function (this: EventTarget, type, listener, options) {
      const i = find(type, listener, captureOf(options))
      if (i >= 0) entries.splice(i, 1)
      return remove.call(this, type, listener, options)
    }
    restore.push(() => {
      const t = target as unknown as Record<string, unknown>
      delete t.addEventListener
      delete t.removeEventListener
      if (own.add) Object.defineProperty(target, 'addEventListener', own.add)
      if (own.remove) Object.defineProperty(target, 'removeEventListener', own.remove)
    })
  }

  return {
    active: () => entries.map((e) => `${e.name}:${e.type}`).sort(),
    stop: () => {
      while (restore.length > 0) restore.pop()!()
    },
  }
}
