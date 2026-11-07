import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterAll, expect } from 'vitest'

/**
 * Golden baselines, one JSON file per suite under tests/golden/__baselines__/.
 *
 * Verify mode (default): each `check(key, value)` compares `value` with the stored
 * entry using a soft toEqual, so a mismatch prints a field-level diff of old against
 * new statistics and the test goes on to report its other goldens. A missing entry
 * fails.
 *
 * Update mode (`UPDATE_GOLDENS=1 npx vitest run tests/golden`): entries are
 * collected and the suite's file is rewritten after its last test. Per the refactor
 * plan's ground rule 3, a baseline changes only in a commit that names the intended
 * behaviour change and its before/after numbers.
 */

const BASELINE_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '../golden/__baselines__')

export const UPDATE_GOLDENS = process.env.UPDATE_GOLDENS === '1'

export interface GoldenSuite {
  check: (key: string, value: unknown) => void
}

export function goldenSuite(name: string): GoldenSuite {
  const file = resolve(BASELINE_DIR, `${name}.json`)
  const stored: Record<string, unknown> = existsSync(file)
    ? (JSON.parse(readFileSync(file, 'utf8')) as Record<string, unknown>)
    : {}
  const collected: Record<string, unknown> = {}

  if (UPDATE_GOLDENS) {
    afterAll(() => {
      mkdirSync(BASELINE_DIR, { recursive: true })
      const sorted = Object.fromEntries(Object.entries(collected).sort(([a], [b]) => a.localeCompare(b)))
      writeFileSync(file, JSON.stringify(sorted, null, 2) + '\n')
    })
  }

  return {
    check(key, value) {
      // Round-trip through JSON so the comparison sees exactly what the file holds.
      const actual: unknown = JSON.parse(JSON.stringify(value))
      if (key in collected) throw new Error(`golden key "${key}" checked twice in suite "${name}"`)
      collected[key] = actual
      if (UPDATE_GOLDENS) return
      if (!(key in stored)) {
        throw new Error(
          `No golden baseline for "${name}/${key}". Run UPDATE_GOLDENS=1 npx vitest run tests/golden and commit the baseline deliberately.`,
        )
      }
      // Soft, so a test that checks several goldens reports every one that changed.
      expect
        .soft(actual, `golden ${name}/${key} changed (expected = stored baseline, received = current output)`)
        .toEqual(stored[key])
    },
  }
}
