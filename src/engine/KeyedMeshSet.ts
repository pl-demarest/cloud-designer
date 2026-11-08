import * as THREE from 'three';

/** The objects a view draws for one item of a keyed list. Each owns its geometry. */
export interface KeyedEntry {
  /** Added to the group in this order. */
  readonly objects: readonly THREE.Object3D[];
}

export interface KeyedMeshSetBuilder<D, E extends KeyedEntry> {
  /** Builds the objects for an item that has just appeared. */
  create(def: D): E;
  /** Updates an existing entry's objects for the item's new definition. */
  update(entry: E, def: D): void;
}

/**
 * Per-id objects for a keyed list (spheres, spirals): an entry is built when its id appears,
 * updated in place while the id stays, and removed from the group, its geometries disposed,
 * when the id goes. Materials are shared (./materials.ts) and never disposed here. Entries keep
 * the order in which they were created.
 */
export class KeyedMeshSet<D extends { id: string }, E extends KeyedEntry> {
  private readonly group: THREE.Group;
  private readonly builder: KeyedMeshSetBuilder<D, E>;
  private readonly entries = new Map<string, E>();

  constructor(group: THREE.Group, builder: KeyedMeshSetBuilder<D, E>) {
    this.group = group;
    this.builder = builder;
  }

  /** Brings the entries in line with `defs`: removes the ids that left, then updates or creates. */
  sync(defs: readonly D[]): void {
    const ids = new Set(defs.map((d) => d.id));
    for (const [id, entry] of this.entries) {
      if (!ids.has(id)) this.remove(id, entry);
    }
    for (const def of defs) {
      const entry = this.entries.get(def.id);
      if (entry) {
        this.builder.update(entry, def);
      } else {
        const created = this.builder.create(def);
        this.group.add(...created.objects);
        this.entries.set(def.id, created);
      }
    }
  }

  /** The entries with their ids, in creation order. */
  [Symbol.iterator](): IterableIterator<[string, E]> {
    return this.entries[Symbol.iterator]();
  }

  values(): IterableIterator<E> {
    return this.entries.values();
  }

  /** Removes and disposes every entry. */
  clear(): void {
    for (const [id, entry] of this.entries) this.remove(id, entry);
  }

  private remove(id: string, entry: E): void {
    this.group.remove(...entry.objects);
    for (const obj of entry.objects) {
      if (obj instanceof THREE.Mesh || obj instanceof THREE.Line) obj.geometry.dispose();
    }
    this.entries.delete(id);
  }
}
