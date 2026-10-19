import { applyD1Migrations, env } from 'cloudflare:test'
import { beforeAll } from 'vitest'
import type { Env } from '../src/index'

declare module 'cloudflare:test' {
  interface ProvidedEnv extends Env {
    TEST_MIGRATIONS: any[]
  }
}

beforeAll(async () => {
  if (env.DB && env.TEST_MIGRATIONS) {
    await applyD1Migrations(env.DB, env.TEST_MIGRATIONS)
  }
})
