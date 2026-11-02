import { describe, test } from 'vitest'
import assert from 'node:assert'
import fs from 'fs'
import os from 'os'
import path from 'path'
import { diskVersionStore, memoryVersionStore, type VersionStore } from '../lib/versionStore'

// One contract over both adapters, so the store tests use cannot drift from the one on disk (#169).
const adapters: [string, () => VersionStore][] = [
  ['disk', () => diskVersionStore(fs.mkdtempSync(path.join(os.tmpdir(), 'version-store-')))],
  ['memory', memoryVersionStore],
]

describe.each(adapters)('%s version store', (_, make) => {
  test('a first snapshot is v1, and unchanged content keeps its number', () => {
    const store = make()
    assert.strictEqual(store.snapshot('agent', 'writer', 'a'), 1)
    assert.strictEqual(store.snapshot('agent', 'writer', 'a'), 1)
    assert.deepStrictEqual(store.list('agent', 'writer').map(v => v.version), [1])
  })

  test('a change adds a version, and changing back adds another: numbers count edits (ADR-0011)', () => {
    const store = make()
    store.snapshot('agent', 'writer', 'a')
    assert.strictEqual(store.snapshot('agent', 'writer', 'b'), 2)
    assert.strictEqual(store.snapshot('agent', 'writer', 'a'), 3)
    assert.deepStrictEqual(store.list('agent', 'writer').map(v => v.version), [3, 2, 1], 'newest first')
  })

  test('reads a version back by number; a missing one is null', () => {
    const store = make()
    store.snapshot('skill', 'tone', 'first')
    store.snapshot('skill', 'tone', 'second')
    assert.strictEqual(store.read('skill', 'tone', 1), 'first')
    assert.strictEqual(store.read('skill', 'tone', 2), 'second')
    assert.strictEqual(store.read('skill', 'tone', 3), null)
    assert.strictEqual(store.read('skill', 'other', 1), null)
  })

  test('files are numbered apart, the slugless defaults file included', () => {
    const store = make()
    store.snapshot('agent', 'writer', 'a')
    store.snapshot('agent', 'writer', 'b')
    assert.strictEqual(store.snapshot('chain', 'writer', 'a'), 1, 'same slug, other type')
    assert.strictEqual(store.snapshot('defaults', '', 'model: m'), 1)
    assert.strictEqual(store.read('defaults', '', 1), 'model: m')
    assert.deepStrictEqual(store.list('tool', 'none'), [])
  })

  test('entries carry a timestamp and the content hash', () => {
    const store = make()
    store.snapshot('context', 'lore', 'x')
    store.snapshot('context', 'lore', 'y')
    const [y, x] = store.list('context', 'lore')
    assert.notStrictEqual(x.hash, y.hash)
    assert.ok(!Number.isNaN(Date.parse(x.timestamp)))
  })
})
