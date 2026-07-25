import { test } from 'vitest'
import assert from 'node:assert'
import { resolveInitialTheme, THEME_STORAGE_KEY } from '../lib/theme'

function main() {
  assert.strictEqual(resolveInitialTheme('dark', false), 'dark', 'stored dark wins over light system pref')
  assert.strictEqual(resolveInitialTheme('light', true), 'light', 'stored light wins over dark system pref')
  assert.strictEqual(resolveInitialTheme(null, true), 'dark', 'no stored value falls back to system pref (dark)')
  assert.strictEqual(resolveInitialTheme(null, false), 'light', 'no stored value falls back to system pref (light)')
  assert.strictEqual(resolveInitialTheme('nonsense', true), 'dark', 'invalid stored value falls back to system pref')
  assert.ok(THEME_STORAGE_KEY.length > 0, 'storage key is a non-empty string')
}

test('theme', main)
