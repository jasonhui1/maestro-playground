import assert from 'node:assert'
import { parseRefs } from '../lib/refs'

// {input}
assert.deepStrictEqual(parseRefs('hello {input} world'), [{ kind: 'input' }])

// agent field, split on LAST dot
assert.deepStrictEqual(
  parseRefs('{world-builder.summary}'),
  [{ kind: 'agent', target: 'world-builder', field: 'summary' }]
)
assert.deepStrictEqual(
  parseRefs('{a.b.c}'),
  [{ kind: 'agent', target: 'a.b', field: 'c' }]
)

// no-dot ref = context file
assert.deepStrictEqual(parseRefs('{lore}'), [{ kind: 'file', target: 'lore' }])

// whitespace trimmed
assert.deepStrictEqual(parseRefs('{  input  }'), [{ kind: 'input' }])

// multiple + dedupe (identical refs collapse, order preserved)
assert.deepStrictEqual(
  parseRefs('{input} {world-builder.summary} {lore} {input}'),
  [
    { kind: 'input' },
    { kind: 'agent', target: 'world-builder', field: 'summary' },
    { kind: 'file', target: 'lore' },
  ]
)

// empty / malformed braces ignored
assert.deepStrictEqual(parseRefs('{} {   } text {x.}'), [])

console.log('✅ parseRefs tests passed')
