import { test } from 'vitest'
import assert from 'node:assert'
import { validateChain } from '../lib/chainGraph'
import { ChainDef } from '../lib/types'

test('chain-input-ports', () => {
  function chain(inputs: ChainDef['inputs']): ChainDef {
    return {
      slug: 'c', name: 'c', description: '', filePath: '',
      nodes: [{ id: 'seed', kind: 'seed' }],
      edges: [],
      inputs,
    }
  }

  assert.strictEqual(validateChain(chain([{ name: 'topic', node: 'seed' }])).valid, true)
  assert.strictEqual(validateChain(chain([{ name: '', node: 'seed' }])).valid, false, 'an empty input name is rejected')
  assert.strictEqual(
    validateChain(chain([{ name: 'topic', node: 'seed' }, { name: 'topic', node: 'seed' }])).valid,
    false,
    'a duplicate input name is rejected',
  )
  assert.strictEqual(
    validateChain(chain([{ name: 'topic', node: 'seed' }, { name: 'topic ', node: 'seed' }])).valid,
    false,
    'names differing only by whitespace are duplicates',
  )
  assert.strictEqual(validateChain(chain([{ name: 'topic', node: 'nowhere' }])).valid, false, 'an input bound to no node is rejected')
  const agentBound = chain([{ name: 'topic', node: 'writer' }])
  agentBound.nodes.push({ id: 'writer', kind: 'report' })
  assert.strictEqual(validateChain(agentBound).valid, false, 'an input bound to a non-seed node is rejected')
})
