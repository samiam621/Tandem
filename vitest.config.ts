import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['apps/*/src/**/*.test.ts', 'packages/*/src/**/*.test.ts'],
  },
})
