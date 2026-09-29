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
})
