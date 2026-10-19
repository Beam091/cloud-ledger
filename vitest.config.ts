import { defineWorkersConfig, readD1Migrations } from '@cloudflare/vitest-pool-workers/config'
import path from 'node:path'

export default defineWorkersConfig(async () => {
  const migrationsPath = path.join(__dirname, 'worker/migrations')
  const migrations = await readD1Migrations(migrationsPath)

  return {
    test: {
      include: ['worker/tests/**/*.test.ts'],
      setupFiles: ['./worker/tests/setup.ts'],
      poolOptions: {
        workers: {
          main: './worker/src/index.ts',
          singleWorker: true,
          wrangler: { configPath: './worker/wrangler.toml' },
          miniflare: {
            // Override assets directory: wrangler.toml points to ../dist which
            // doesn't exist before a frontend build. Use a committed stub so CI
            // tests pass without requiring a prior build step.
            workerOptions: {
              assetsDirectory: path.join(__dirname, 'worker/tests/assets'),
            },
            bindings: {
              JWT_SECRET: 'test-jwt-secret-key-12345678901234567890',
              ENCRYPTION_KEY: 'MDEyMzQ1Njc4OWFiY2RlZjAxMjM0NTY3ODlhYmNkZWY=',
              APP_ORIGIN: 'http://localhost:5173',
              ENVIRONMENT: 'development',
              TEST_MIGRATIONS: migrations,
            },
          },
        },
      },
    },
  }
})
