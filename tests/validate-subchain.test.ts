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

// cycle that does NOT pass back through the edited chain (host -> b <-> c)
const H = mk('host', ['b']); const Bc = mk('b', ['c']); const Cc = mk('c', ['b'])
assert.ok(validateChain(H, [], [H, Bc, Cc]).errors.some(e => /cycle/i.test(e)), 'cycle reachable from host must be caught')

// referenced chain with no declared outputs -> a non-blocking WARNING (not an error)
const P = mk('p', ['q']); const Q: ChainDef = { ...mk('q', []), outputs: [] }
const pres = validateChain(P, [], [P, Q])
assert.ok(pres.issues.some(i => i.severity === 'warning' && /no .*outputs|nothing to wire/i.test(i.message)), 'no-outputs should be a warning')
assert.ok(!pres.errors.some(e => /no .*outputs|nothing to wire/i.test(e)), 'no-outputs must not block the run')

// valid acyclic reference with outputs passes the subchain checks
const okP = mk('p', ['q']); const okQ = mk('q', [])
assert.ok(!validateChain(okP, [], [okP, okQ]).errors.some(e => /cycle|unknown chain/i.test(e)))

// output/input port names that aren't already slug-form must still validate + be wireable
const refCap: ChainDef = {
  slug: 'triage2', name: 'Triage2', description: '', filePath: '',
  nodes: [{ id: 'seedA', kind: 'seed' }, { id: 'w', kind: 'agent', agent: 'x' }],
  edges: [],
  inputs: [{ name: 'Topic', node: 'seedA' }],
  outputs: [{ name: 'Verdict', node: 'w' }],   // capital V
}
const hostCap: ChainDef = {
  slug: 'hostcap', name: 'HostCap', description: '', filePath: '',
  nodes: [
    { id: 'seedH', kind: 'seed' },
    { id: 'sub', kind: 'subchain', subchain: 'triage2' },
    { id: 'g', kind: 'gate', condition: 'true' },
  ],
  edges: [
    { fromNode: 'seedH', fromSocket: 'output', toNode: 'sub', toSocket: 'Topic' },
    { fromNode: 'sub', fromSocket: 'Verdict', toNode: 'g', toSocket: 'in' },
  ],
}
assert.ok(
  !validateChain(hostCap, [], [hostCap, refCap]).errors.some(e => /no such output socket|no such input slot/i.test(e)),
  'capitalized subchain port names must validate + be wireable',
)

console.log('✅ validate-subchain tests passed')
