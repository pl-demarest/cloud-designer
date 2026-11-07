import { createHash } from 'node:crypto'

/**
 * Golden digests: a compact, diff-readable fingerprint of numeric output.
 *
 * Every typed array is reduced to its constructor, length, NaN and infinity
 * counts, min, max, sum and sum of squares (accumulated in float64 over the
 * finite values, in index order), and a SHA-256 of its raw bytes. The hash
 * catches any change at all, including a pure reordering; the statistics say
 * what kind of change it was and by how much.
 */

/** JSON cannot hold NaN or Infinity, so non-finite numbers are stored as strings. */
export type JsonNumber = number | string

export interface ArrayDigest {
  type: string
  length: number
  nan: number
  inf: number
  min: JsonNumber | null
  max: JsonNumber | null
  sum: JsonNumber
  sumSq: JsonNumber
  sha256: string
}

export interface ArrayListDigest {
  count: number
  items: ArrayDigest[]
}

type NumericArray =
  | Float32Array
  | Float64Array
  | Int8Array
  | Int16Array
  | Int32Array
  | Uint8Array
  | Uint16Array
  | Uint32Array
  | Uint8ClampedArray

function jsonNumber(n: number): JsonNumber {
  return Number.isFinite(n) ? n : String(n)
}

export function digestArray(arr: NumericArray): ArrayDigest {
  let nan = 0
  let inf = 0
  let min = Infinity
  let max = -Infinity
  let sum = 0
  let sumSq = 0
  for (let i = 0; i < arr.length; i++) {
    const v = arr[i]
    if (Number.isNaN(v)) {
      nan++
      continue
    }
    if (!Number.isFinite(v)) {
      inf++
      continue
    }
    if (v < min) min = v
    if (v > max) max = v
    sum += v
    sumSq += v * v
  }
  const finite = arr.length - nan - inf
  const bytes = new Uint8Array(arr.buffer, arr.byteOffset, arr.byteLength)
  return {
    type: arr.constructor.name,
    length: arr.length,
    nan,
    inf,
    min: finite > 0 ? jsonNumber(min) : null,
    max: finite > 0 ? jsonNumber(max) : null,
    sum: jsonNumber(sum),
    sumSq: jsonNumber(sumSq),
    sha256: createHash('sha256').update(bytes).digest('hex'),
  }
}

export function digestArrayList(list: readonly NumericArray[]): ArrayListDigest {
  return { count: list.length, items: list.map(digestArray) }
}

function isNumericArray(v: unknown): v is NumericArray {
  return ArrayBuffer.isView(v) && !(v instanceof DataView)
}

/**
 * Digest an arbitrary output value: typed arrays become ArrayDigests, arrays of
 * typed arrays become ArrayListDigests, plain objects and arrays recurse, and
 * scalars pass through (non-finite numbers as strings).
 */
export function digestValue(v: unknown): unknown {
  if (isNumericArray(v)) return digestArray(v)
  if (Array.isArray(v)) {
    if (v.length > 0 && v.every(isNumericArray)) return digestArrayList(v)
    return v.map(digestValue)
  }
  if (typeof v === 'number') return jsonNumber(v)
  if (v && typeof v === 'object') {
    const out: Record<string, unknown> = {}
    for (const [k, val] of Object.entries(v)) out[k] = digestValue(val)
    return out
  }
  return v
}
