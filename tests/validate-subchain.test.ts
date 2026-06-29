import assert from 'node:assert'
import { validateChain } from '../lib/chainGraph'
import { ChainDef } from '../lib/types'

const mk = (slug: string, refs: string[], outputs = [{ name: 'out', node: 'seed' }]): ChainDef => ({
  slug, name: slug, description: '', filePath: '',
  nodes: [{ id: 'seed', kind: 'seed' }, ...refs.map((r, i) => ({ id: `sub${i}`, kind: 'subchain' as const, subchain: r }))],
  edges: [], outputs,
})

// unknown reference
const u = mk('a', ['ghost'])
assert.ok(validateChain(u, [], [u]).errors.some(e => /unknown chain|not found/i.test(e)))

// self-reference cycle
const s = mk('a', ['a'])
assert.ok(validateChain(s, [], [s]).errors.some(e => /cycle/i.test(e)))

// mutual A<->B cycle
const A = mk('a', ['b']); const B = mk('b', ['a'])
assert.ok(validateChain(A, [], [A, B]).errors.some(e => /cycle/i.test(e)))

// referenced chain with no declared outputs -> a warning-level issue mentioning outputs
const P = mk('p', ['q']); const Q: ChainDef = { ...mk('q', []), outputs: [] }
assert.ok(validateChain(P, [], [P, Q]).errors.some(e => /no .*outputs|nothing to wire/i.test(e)))

// valid acyclic reference with outputs passes the subchain checks
const okP = mk('p', ['q']); const okQ = mk('q', [])
assert.ok(!validateChain(okP, [], [okP, okQ]).errors.some(e => /cycle|unknown chain/i.test(e)))

console.log('✅ validate-subchain tests passed')
