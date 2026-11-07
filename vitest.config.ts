import { defineConfig, mergeConfig } from 'vitest/config'
import viteConfig from './vite.config'

export default mergeConfig(
  viteConfig,
  defineConfig({
    test: {
      // Pure logic runs in node. A test that needs a DOM declares
      // `// @vitest-environment happy-dom` at the top of the file.
      environment: 'node',
      include: ['src/**/*.test.{ts,tsx}', 'tests/{unit,golden}/**/*.test.{ts,tsx}'],
      exclude: ['tests/e2e/**', 'node_modules/**', 'dist/**'],
    },
  }),
)
