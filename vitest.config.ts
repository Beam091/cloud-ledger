import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: ['worker/tests/**/*.test.ts'],
    environment: 'node',
  },
})
