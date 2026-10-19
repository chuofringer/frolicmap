import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import path from 'node:path'

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, 'src'),
      '@shared': path.resolve(__dirname, 'shared'),
    },
  },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./src/test-setup.ts'],
    // Pin the VIEWER's timezone. Event times render on the venue's wall clock
    // (#489) and append a zone suffix only when the venue differs from the
    // viewer — so any test asserting a rendered time silently depends on the
    // machine running it. A Bay Area laptop and a UTC CI runner disagree, and
    // the laptop is the one that stays green. UTC because it makes local runs
    // behave like CI, which is the direction that catches the mistake.
    env: { TZ: 'UTC' },
    // scripts/lib/*.test.mjs use Node's built-in test runner (`node --test`),
    // not Vitest — their `import { test } from 'node:test'` can't be bundled
    // by Vite. Run them via `node --test scripts/lib/*.test.mjs` separately.
    // .claude/worktrees holds transient agent worktrees — full repo copies
    // whose test files would be double-collected (and can be stale against
    // the primary checkout's shared/, producing phantom failures).
    exclude: ['**/node_modules/**', '**/worker/**', '**/scripts/**', '**/.claude/**'],
  },
})
