import { test } from 'vitest'
import assert from 'node:assert'
import {
  parseToken, scanTokens, promptSlots, replaceTokens, fillSlot,
  parseEndpoint, endpointOf, socketKey, isWholeOutput,
} from '../lib/tokens'

test('a bare token is a slot; a dotted token is a ref', () => {
  assert.deepStrictEqual(parseToken('world'), { kind: 'slot', name: 'world' })
  assert.deepStrictEqual(parseToken('wb.summary'), { kind: 'ref', node: 'wb', socket: 'summary' })
  assert.deepStrictEqual(parseToken('  wb . summary  '), { kind: 'ref', node: 'wb', socket: 'summary' })
})

test('the dot rule: split on the first dot, the rest is one opaque socket', () => {
  assert.deepStrictEqual(parseToken('a.b.c'), { kind: 'ref', node: 'a', socket: 'b.c' })
  assert.deepStrictEqual(parseEndpoint('a.b.c'), { node: 'a', socket: 'b.c' })
  assert.deepStrictEqual(scanTokens('{a.b.c}'), [{ kind: 'ref', node: 'a', socket: 'b.c' }])
})

test('empty or half-dotted tokens are not tokens', () => {
  assert.strictEqual(parseToken(''), undefined)
  assert.strictEqual(parseToken('   '), undefined)
  assert.strictEqual(parseToken('x.'), undefined)
  assert.strictEqual(parseToken('.x'), undefined)
  assert.deepStrictEqual(scanTokens('{} {   } text {x.} {.x}'), [])
})

test('scanTokens keeps order and duplicates', () => {
  assert.deepStrictEqual(scanTokens('{input} {wb.summary} {lore} {input}'), [
    { kind: 'slot', name: 'input' },
    { kind: 'ref', node: 'wb', socket: 'summary' },
    { kind: 'slot', name: 'lore' },
    { kind: 'slot', name: 'input' },
  ])
})

test('promptSlots: bare tokens, trimmed, deduped; refs are not slots', () => {
  assert.deepStrictEqual(promptSlots('World: {world}\nChars: {characters}'), ['world', 'characters'])
  assert.deepStrictEqual(promptSlots('{input} then {input}'), ['input'])
  assert.deepStrictEqual(promptSlots('{ world }'), ['world'])
  assert.deepStrictEqual(promptSlots('{a.b} {world}'), ['world'])
  assert.deepStrictEqual(promptSlots('no slots here'), [])
})

test('replaceTokens rewrites each token; returning undefined keeps it verbatim', () => {
  const out = replaceTokens('{ a } {b.c} {} {x.}', t => t.kind === 'slot' ? `<${t.name}>` : undefined)
  assert.strictEqual(out, '<a> {b.c} {} {x.}')
})

test('fillSlot replaces every occurrence of one slot and reports whether it was there', () => {
  assert.deepStrictEqual(fillSlot('{ tone } and {tone}, not {tone.x}', 'tone', 'dry'), { text: 'dry and dry, not {tone.x}', found: true })
  assert.deepStrictEqual(fillSlot('{a}', 'b', 'v'), { text: '{a}', found: false })
  // a slot name is literal, never a pattern
  assert.deepStrictEqual(fillSlot('{a+}', 'a+', 'v'), { text: 'v', found: true })
  assert.deepStrictEqual(fillSlot('{aa}', 'a+', 'v'), { text: '{aa}', found: false })
})

test('an endpoint without a socket reads the whole output', () => {
  assert.deepStrictEqual(parseEndpoint('seed'), { node: 'seed', socket: 'output' })
  assert.deepStrictEqual(parseEndpoint(' wb . input '), { node: 'wb', socket: 'input' })
  assert.deepStrictEqual(endpointOf({ kind: 'slot', name: 'v' }), { node: 'v', socket: 'output' })
  assert.deepStrictEqual(endpointOf({ kind: 'ref', node: 'v', socket: 'Verdict' }), { node: 'v', socket: 'Verdict' })
})

test('sockets match slugified; output is the whole output', () => {
  assert.strictEqual(socketKey('Final Verdict'), 'final-verdict')
  assert.strictEqual(isWholeOutput('Output'), true)
  assert.strictEqual(isWholeOutput('summary'), false)
})
