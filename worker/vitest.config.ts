import { defineConfig } from 'vitest/config'
import { cloudflareTest } from '@cloudflare/vitest-pool-workers'
import path from 'path'

export default defineConfig({
  // Node-only scripts (e.g. merge-*.mjs) have their own `.test.mjs` tests that
  // run via `node --test`. They use child_process / fs and crash inside
  // Miniflare's isolate. Restrict Vitest to `.test.ts` to skip them.
  test: {
    include: ['test/**/*.test.ts'],
  },
  plugins: [
    cloudflareTest({
      main: './src/index.ts',
      wrangler: { configPath: './wrangler.toml' },
      remoteBindings: false,
      miniflare: {
        d1Databases: ['DB'],
        compatibilityFlags: ['nodejs_compat'],
        bindings: {
          DEV_ADMIN_BYPASS: 'yes',
          // Phase 2a: enables `POST /api/session` in integration tests. Any
          // random string works — signing key is only used to mint + verify,
          // not to authenticate. Production secret is set via
          // `wrangler secret put SESSION_SIGNING_KEY`.
          SESSION_SIGNING_KEY: 'test-key-for-vitest-only-change-in-prod-xyz123',
          // Enables /api/internal/* route tests (#422 hardening) — any
          // string works, it's only compared via HMAC, never sent anywhere.
          EXTRACT_SECRET: 'test-extract-secret-for-vitest-only',
        },
      },
    }),
  ],
  resolve: {
    alias: {
      '@shared': path.resolve(__dirname, '../shared'),
    },
  },
})
