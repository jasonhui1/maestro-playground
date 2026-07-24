import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    // Every test file registers at least one test(). A file that registers none
    // is a test that silently stopped running, which must read as failure —
    // that was the hole this config option used to hide.
    passWithNoTests: false,
    include: ['tests/**/*.{test,spec}.{js,mjs,cjs,ts,mts,cts,jsx,tsx}'],
  },
})
