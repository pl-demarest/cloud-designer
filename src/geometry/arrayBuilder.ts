/**
 * Typed arrays that grow as values are appended, for output whose length is not known in
 * advance. The capacity doubles when it runs out, so appending is amortised O(1) and nothing is
 * allocated per value. Values are stored as the array type stores them: a Float32Array rounds
 * each number to float32 exactly as `new Float32Array(numbers)` would.
 */

export class Float32Builder {
  private data: Float32Array;
  length = 0;

  constructor(initialCapacity = 1024) {
    this.data = new Float32Array(Math.max(3, initialCapacity));
  }

  push3(x: number, y: number, z: number): void {
    if (this.length + 3 > this.data.length) this.grow(this.length + 3);
    const d = this.data;
    const n = this.length;
    d[n] = x;
    d[n + 1] = y;
    d[n + 2] = z;
    this.length = n + 3;
  }

  private grow(min: number): void {
    const next = new Float32Array(Math.max(min, this.data.length * 2));
    next.set(this.data.subarray(0, this.length));
    this.data = next;
  }

  /** The values appended so far, as an exactly sized copy with its own buffer. */
  toArray(): Float32Array {
    return this.data.slice(0, this.length);
  }
}

export class Uint32Builder {
  private data: Uint32Array;
  length = 0;

  constructor(initialCapacity = 1024) {
    this.data = new Uint32Array(Math.max(3, initialCapacity));
  }

  push3(a: number, b: number, c: number): void {
    if (this.length + 3 > this.data.length) this.grow(this.length + 3);
    const d = this.data;
    const n = this.length;
    d[n] = a;
    d[n + 1] = b;
    d[n + 2] = c;
    this.length = n + 3;
  }

  private grow(min: number): void {
    const next = new Uint32Array(Math.max(min, this.data.length * 2));
    next.set(this.data.subarray(0, this.length));
    this.data = next;
  }

  /** The values appended so far, as an exactly sized copy with its own buffer. */
  toArray(): Uint32Array {
    return this.data.slice(0, this.length);
  }
}
