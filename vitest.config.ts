import { defineConfig } from 'vitest/config'
import path from 'path'

export default defineConfig({
  // Mirrors tsconfig's `@/*` so route handlers under app/api (which import via `@/lib/...`)
  // load the same way in tests as they do under Next's own bundler.
  resolve: {
    alias: { '@': path.resolve(__dirname) },
  },
  test: {
    // Every test file registers at least one test(). A file that registers none
    // is a test that silently stopped running, which must read as failure —
    // that was the hole this config option used to hide.
    passWithNoTests: false,
    include: ['tests/**/*.{test,spec}.{js,mjs,cjs,ts,mts,cts,jsx,tsx}'],
  },
})
