#!/usr/bin/env node
import { execSync } from 'child_process'
import path from 'path'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const rootDir = path.resolve(__dirname, '..')

if (process.env.CI) {
  console.error('Error: Refusing to update contract fixtures in CI environment')
  process.exit(1)
}

try {
  execSync('npx vitest run tests/contracts.test.ts', {
    cwd: rootDir,
    stdio: 'inherit',
    env: {
      ...process.env,
      UPDATE_CONTRACTS: '1',
    },
  })
} catch (err) {
  process.exit(err.status ?? 1)
}
