import { describe, expect, test } from 'vitest'
import { sameValue } from '../../src/engine/sameValue'

/** Structural equality for preset data (cd:review CDR-16: no test read it directly, and dropping
 *  its key-count check survived the suite). */
describe('sameValue', () => {
  test('equal data, nested', () => {
    expect(sameValue({ a: [1, { b: 'x' }], c: true }, { c: true, a: [1, { b: 'x' }] })).toBe(true)
  })

  test('an extra key on either side differs', () => {
    expect(sameValue({ a: 1 }, { a: 1, b: undefined })).toBe(false)
    expect(sameValue({ a: 1, b: 2 }, { a: 1 })).toBe(false)
  })

  test('numbers compare with Object.is: -0 and 0 differ, NaN equals NaN', () => {
    expect(sameValue(-0, 0)).toBe(false)
    expect(sameValue([0, -0], [0, -0])).toBe(true)
    expect(sameValue(NaN, NaN)).toBe(true)
  })

  test('an array is not an object with the same indices, and lengths must match', () => {
    expect(sameValue([1, 2], { 0: 1, 1: 2 })).toBe(false)
    expect(sameValue([1, 2], [1, 2, 3])).toBe(false)
    expect(sameValue(null, {})).toBe(false)
  })
})
