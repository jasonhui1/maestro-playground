import { test } from 'vitest'
import assert from 'node:assert'
import { runChainGraph } from '../lib/executor'
import type { ChainDef } from '../lib/types'
import { runAgent } from '../lib/runner'

test('report-executor', async () => {
  async function run() {
    const chain: ChainDef = {
      slug: 'c', name: 'c', description: '', filePath: '',
      nodes: [{ id: 'seed', kind: 'seed' }, { id: 'r', kind: 'report' }],
      edges: [{ fromNode: 'seed', fromSocket: 'output', toNode: 'r', toSocket: 'in' }],
    }
    let called = 0
    const runFn: typeof runAgent = async () => { called++; throw new Error('should not run') }

    const results = await runChainGraph(
      chain, [], [], 'HELLO WORLD', process.cwd(),
      { onStart() {}, onToken() {}, onDone() {} }, runFn,
    )
    const rep = results.find(r => r.nodeId === 'r')!
    assert.strictEqual(rep.output, 'HELLO WORLD', 'report passes seed through')
    assert.strictEqual(rep.status, 'success')
    assert.strictEqual(called, 0, 'no model call for report')
  }

  await run()
})
