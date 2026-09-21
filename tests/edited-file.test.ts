import { test } from 'vitest'
import assert from 'node:assert'
import {
  editedFileReducer as step,
  emptyEditedFile,
  splitFrontmatter,
  type EditedFileState,
  type EditedFileEvent,
} from '../lib/editedFile'

// Drive the fold as a pure reducer: events in, { content, status, conflict } out.
function fold(events: EditedFileEvent[], from: EditedFileState = emptyEditedFile): EditedFileState {
  return events.reduce(step, from)
}

const opened = (raw: string) => fold([{ type: 'loaded', raw }])

test('edited-file: load then edit then save', () => {
  const loaded = opened('A')
  assert.strictEqual(loaded.content, 'A')
  assert.strictEqual(loaded.status, 'idle')
  assert.strictEqual(loaded.loaded, true)

  const edited = step(loaded, { type: 'edit', content: 'B' })
  assert.strictEqual(edited.content, 'B')
  assert.strictEqual(edited.onDisk, 'A')

  const saved = fold([{ type: 'save-start' }, { type: 'save-ok', content: 'B' }], edited)
  assert.strictEqual(saved.status, 'saved')
  assert.strictEqual(saved.onDisk, 'B')
  assert.strictEqual(saved.error, null)
})

test('edited-file: a failed save keeps the buffer and reports why', () => {
  const failed = fold(
    [{ type: 'edit', content: 'B' }, { type: 'save-start' }, { type: 'save-error', message: 'disk full' }],
    opened('A'),
  )
  assert.strictEqual(failed.status, 'error')
  assert.strictEqual(failed.error, 'disk full')
  assert.strictEqual(failed.content, 'B')
  assert.strictEqual(failed.onDisk, 'A')
})

test('edited-file: unparseable frontmatter blocks the write without erroring', () => {
  const skipped = fold([{ type: 'edit', content: 'B' }, { type: 'save-skipped' }], opened('A'))
  assert.strictEqual(skipped.status, 'idle')
  assert.strictEqual(skipped.error, null)
  assert.strictEqual(skipped.onDisk, 'A')
})

test('edited-file: our own write echoes back and changes nothing', () => {
  const after = fold(
    [{ type: 'edit', content: 'B' }, { type: 'save-start' }, { type: 'save-ok', content: 'B' }],
    opened('A'),
  )
  const echo = step(after, { type: 'external', raw: 'B' })
  assert.strictEqual(echo, after)
  assert.strictEqual(echo.conflict, null)
})

test('edited-file: a clean buffer adopts the disk and bumps externalRevision', () => {
  const clean = opened('A')
  const adopted = step(clean, { type: 'external', raw: 'B' })
  assert.strictEqual(adopted.content, 'B')
  assert.strictEqual(adopted.onDisk, 'B')
  assert.strictEqual(adopted.conflict, null)
  assert.strictEqual(adopted.externalRevision, clean.externalRevision + 1)
  assert.strictEqual(adopted.onDisk, 'B')
})

test('edited-file: a dirty buffer conflicts instead of adopting', () => {
  const dirty = step(opened('A'), { type: 'edit', content: 'C' })
  const clash = step(dirty, { type: 'external', raw: 'B' })
  assert.strictEqual(clash.conflict, 'B')
  assert.strictEqual(clash.content, 'C')
  assert.strictEqual(clash.externalRevision, dirty.externalRevision)
})

test('edited-file: resolving theirs takes the disk copy', () => {
  const clash = fold([{ type: 'edit', content: 'C' }, { type: 'external', raw: 'B' }], opened('A'))
  const theirs = step(clash, { type: 'resolve', choice: 'theirs' })
  assert.strictEqual(theirs.content, 'B')
  assert.strictEqual(theirs.onDisk, 'B')
  assert.strictEqual(theirs.conflict, null)
  assert.strictEqual(theirs.externalRevision, clash.externalRevision + 1)
})

test('edited-file: resolving mine keeps the buffer dirty so it saves over disk', () => {
  const clash = fold([{ type: 'edit', content: 'C' }, { type: 'external', raw: 'B' }], opened('A'))
  const mine = step(clash, { type: 'resolve', choice: 'mine' })
  assert.strictEqual(mine.content, 'C')
  assert.strictEqual(mine.conflict, null)
  assert.notStrictEqual(mine.content, mine.onDisk)
})

test('edited-file: resolving with no conflict open is a no-op', () => {
  const clean = opened('A')
  assert.strictEqual(step(clean, { type: 'resolve', choice: 'theirs' }), clean)
})

test('edited-file: a second disk change replaces the pending conflict', () => {
  const clash = fold([{ type: 'edit', content: 'C' }, { type: 'external', raw: 'B' }], opened('A'))
  assert.strictEqual(step(clash, { type: 'external', raw: 'B2' }).conflict, 'B2')
})

test('edited-file: load failure surfaces and leaves the file unloaded', () => {
  const failed = step(emptyEditedFile, { type: 'load-error', message: 'nope' })
  assert.strictEqual(failed.loadError, 'nope')
  assert.strictEqual(failed.loaded, false)
})

test('edited-file: frontmatter splits, and invalid yaml reports null', () => {
  const split = splitFrontmatter('---\nname: a\n---\nbody\n')
  assert.deepStrictEqual(split?.data, { name: 'a' })
  assert.strictEqual(split?.content.trim(), 'body')
  assert.strictEqual(splitFrontmatter('---\n: :\n- ]\n---\nbody\n'), null)
})
