import { test } from 'vitest'
import assert from 'node:assert'
import fs from 'fs'
import path from 'path'
import os from 'os'
import { retrieveExecutor } from '../lib/tools/retrieveExecutor'

test('retrieve-executor', () => {
  const wp = fs.mkdtempSync(path.join(os.tmpdir(), 'retrieve-executor-ws-'))
  fs.mkdirSync(path.join(wp, 'context'))
  fs.writeFileSync(path.join(wp, 'context', 'tavern-lore.md'), `# Tavern Lore

## The Gilded Flagon
Owned by Mirna Copperhand since the fire of '42.

## The Rusty Anchor
A dockside dive with cheap ale.
`)
  fs.writeFileSync(path.join(wp, 'context', 'unrelated.md'), `## Weather
It rains a lot in the harbor district.
`)

  // top-N sections with file › heading provenance, scored by query-term hits
  {
    const result = retrieveExecutor({ query: 'Gilded Flagon owner' }, {}, wp)
    assert.match(result, /### context\/tavern-lore\.md › The Gilded Flagon/)
    assert.match(result, /Mirna Copperhand/)
    assert.doesNotMatch(result, /Rusty Anchor/)
  }

  // respects config.maxResults
  {
    const result = retrieveExecutor({ query: 'the' }, { maxResults: 1 }, wp)
    const matches = result.match(/^### /gm) ?? []
    assert.strictEqual(matches.length, 1)
  }

  // friendly no-match message
  {
    const result = retrieveExecutor({ query: 'nonexistent-term-xyz' }, {}, wp)
    assert.match(result, /No matching sections found/)
  }

  // respects config.folders (default is ['context'] — a sibling folder is ignored unless named)
  {
    fs.mkdirSync(path.join(wp, 'notes'))
    fs.writeFileSync(path.join(wp, 'notes', 'extra.md'), `## Secret\nThe password is hunter2.\n`)
    const defaultResult = retrieveExecutor({ query: 'password' }, {}, wp)
    assert.match(defaultResult, /No matching sections found/)
    const scopedResult = retrieveExecutor({ query: 'password' }, { folders: ['notes'] }, wp)
    assert.match(scopedResult, /notes\/extra\.md › Secret/)
  }

  // path-traversal guard rejects folders outside the workspace
  {
    assert.throws(() => retrieveExecutor({ query: 'x' }, { folders: ['../../etc'] }, wp), /outside the workspace/)
  }
})
