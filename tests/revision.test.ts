import { test } from 'vitest'
import assert from 'node:assert'
import fixture from './fixtures/addressed-revision.json'
import { readRevision, reviseOutput } from '../lib/revision'
import { isRefusal } from '../lib/refusal'
import { socketReading } from '../lib/nodeSockets'

// The same cases the Obsidian consumer runs (obsidian-chain-runner #139), so both
// sides agree on what an addressed edit does to a node's whole output (#160).
for (const c of fixture.cases) {
  test(c.name, () => {
    const revision = readRevision(c.revision)
    const result = isRefusal(revision) ? revision : reviseOutput(c.output, revision, socket => socketReading('agent', socket, false))
    if ('refused' in c.expect) {
      assert.ok(isRefusal(result), `expected a refusal, got ${JSON.stringify(result)}`)
      assert.strictEqual(result.status, c.expect.refused, result.error)
    } else {
      assert.ok(!isRefusal(result), isRefusal(result) ? result.error : '')
      assert.strictEqual(result.output, c.expect.output)
    }
  })
}
