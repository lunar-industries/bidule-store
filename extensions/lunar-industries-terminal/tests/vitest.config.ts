import { defineConfig } from 'vitest/config'

// The module's server tests, in Node: `npx vitest run --config tests/vitest.config.ts` from the module's folder (the
// core's Vitest takes the interface tests in ui/).
export default defineConfig({
  test: { include: ['tests/**/*.test.ts'], environment: 'node' },
})
