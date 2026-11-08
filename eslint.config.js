import js from '@eslint/js'
import globals from 'globals'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import tseslint from 'typescript-eslint'
import { defineConfig, globalIgnores } from 'eslint/config'

/**
 * The dependency rules of docs/ARCHITECTURE.md (Layers and dependency rules): a folder of src/
 * imports no layer its row in the layer table leaves out, and the model, the kernel and the
 * workers import nothing from three.js (rule 1). A relative import names the folder it reaches.
 */
const THREE = { regex: '^three($|/)', message: 'Rule 1: the model, the kernel and the workers import nothing from three.js.' }
function layer(folder, forbidden, extra = []) {
  return {
    files: [`src/${folder}/**/*.{ts,tsx}`],
    rules: {
      'no-restricted-imports': ['error', {
        patterns: [
          {
            regex: `^(\\.\\./)+(${forbidden.join('|')})/`,
            message: `docs/ARCHITECTURE.md, Layers and dependency rules: src/${folder} does not import ${forbidden.join(', ')}.`,
          },
          ...extra,
        ],
      }],
    },
  }
}

export default defineConfig([
  globalIgnores([
    '**/._*',
    'dist',
    'coverage',
    'playwright-report',
    'test-results',
  ]),
  {
    files: ['**/*.{ts,tsx}'],
    extends: [
      js.configs.recommended,
      tseslint.configs.recommended,
      reactHooks.configs.flat.recommended,
      reactRefresh.configs.vite,
    ],
    languageOptions: {
      ecmaVersion: 2020,
      globals: globals.browser,
    },
  },
  layer('model', ['geometry', 'workers', 'engine', 'store', 'ui', 'export'], [THREE]),
  layer('geometry', ['workers', 'engine', 'store', 'ui', 'export'], [THREE]),
  layer('workers', ['engine', 'store', 'ui', 'export'], [THREE]),
  layer('engine', ['ui', 'export']),
  layer('store', ['geometry', 'engine', 'ui', 'export']),
  layer('ui', ['workers']),
  layer('export', ['model', 'geometry', 'workers', 'engine', 'store', 'ui']),
])
