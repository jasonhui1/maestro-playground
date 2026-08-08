import { test } from 'vitest'
import assert from 'node:assert'
import fs from 'fs'
import path from 'path'
import os from 'os'
import { discoverFiles } from '../lib/fs/discover'

function tmpDir(prefix: string) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix))
}

function write(root: string, rel: string, body: string) {
  const p = path.join(root, rel)
  fs.mkdirSync(path.dirname(p), { recursive: true })
  fs.writeFileSync(p, body)
  return p
}

test('discover: recurses to any depth and keeps the slug bare', () => {
  const dir = tmpDir('discover-')
  write(dir, 'flat.md', 'flat body')
  write(dir, 'panel/optimist.md', 'optimist body')
  write(dir, 'panel/deep/nested/skeptic.md', 'skeptic body')

  const found = discoverFiles(dir)
  const slugs = found.map(f => f.slug).sort()
  assert.deepStrictEqual(slugs, ['flat', 'optimist', 'skeptic'])

  // the folder never appears in the slug, and raw content comes back with it
  const optimist = found.find(f => f.slug === 'optimist')!
  assert.strictEqual(optimist.raw, 'optimist body')
  assert.strictEqual(optimist.filePath, path.join(dir, 'panel', 'optimist.md'))
})

test('discover: a duplicate slug throws and the error names both paths', () => {
  const dir = tmpDir('discover-dup-')
  const a = write(dir, 'optimist.md', 'a')
  const b = write(dir, 'panel/optimist.md', 'b')

  assert.throws(
    () => discoverFiles(dir),
    (err: Error) => err.message.includes(a) && err.message.includes(b) && err.message.includes('optimist')
  )
})

test('discover: a flat directory and a missing directory both still work', () => {
  const dir = tmpDir('discover-flat-')
  write(dir, 'one.md', 'one')
  write(dir, 'two.md', 'two')
  assert.deepStrictEqual(discoverFiles(dir).map(f => f.slug).sort(), ['one', 'two'])

  assert.deepStrictEqual(discoverFiles(path.join(dir, 'nope')), [])
})

test('discover: non-markdown files and dot-prefixed entries are skipped', () => {
  const dir = tmpDir('discover-skip-')
  write(dir, 'real.md', 'real')
  write(dir, 'notes.txt', 'ignored')
  write(dir, '.hidden.md', 'ignored')
  write(dir, '.versions/real.md', 'ignored')

  assert.deepStrictEqual(discoverFiles(dir).map(f => f.slug), ['real'])
})
