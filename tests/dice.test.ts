import { test } from 'vitest'
import assert from 'node:assert'
import { normalizeDice, rollDice, fillDice, readDicePins } from '../lib/dice'
import { agentSlots, promptSlots } from '../lib/tokens'
import type { AgentDef, ChainDef } from '../lib/types'

// Walks the values in order, so a roll is predictable: 0 picks the first remaining value.
const alwaysFirst = () => 0

test('a bare list is a one-draw axis; a map states values and draws', () => {
  assert.deepStrictEqual(normalizeDice({
    hair: ['bob', 'curls'],
    styling: { values: ['a', 'b', 'c'], draws: 2 },
    reveal: { values: ['x', 'y'], draws: [1, 2] },
  }, 'f.md'), {
    hair: { values: ['bob', 'curls'], draws: 1 },
    styling: { values: ['a', 'b', 'c'], draws: 2 },
    reveal: { values: ['x', 'y'], draws: [1, 2] },
  })
  assert.strictEqual(normalizeDice(undefined, 'f.md'), undefined)
})

test('a malformed dice block throws naming the file and axis', () => {
  assert.throws(() => normalizeDice(['a'], 'f.md'), /f\.md: "dice" must map axis names to values/)
  assert.throws(() => normalizeDice({ hair: [] }, 'f.md'), /f\.md: dice axis "hair" has no values/)
  assert.throws(() => normalizeDice({ hair: { values: ['a'], draws: 2 } }, 'f.md'), /axis "hair" draws 2 of 1 value/)
  assert.throws(() => normalizeDice({ hair: { values: ['a', 'b'], draws: [2, 1] } }, 'f.md'), /axis "hair"/)
  assert.throws(() => normalizeDice({ hair: { values: ['a'], draws: 'one' } }, 'f.md'), /axis "hair"/)
  assert.throws(() => normalizeDice({ hair: [{ deep: 1 }] }, 'f.md'), /axis "hair"/)
})

test('a roll draws distinct values per axis', () => {
  const dice = normalizeDice({ styling: { values: ['a', 'b', 'c'], draws: 2 }, hair: ['bob', 'curls'] }, 'f.md')!
  assert.deepStrictEqual(rollDice(dice, {}, alwaysFirst), { styling: ['a', 'b'], hair: ['bob'] })
  for (let i = 0; i < 20; i++) {
    const { styling } = rollDice(dice)
    assert.strictEqual(new Set(styling).size, 2)
  }
})

test('[min, max] draws roll the count', () => {
  const dice = normalizeDice({ reveal: { values: ['x', 'y', 'z'], draws: [1, 3] } }, 'f.md')!
  const counts = new Set(Array.from({ length: 200 }, () => rollDice(dice).reveal.length))
  assert.deepStrictEqual([...counts].sort(), [1, 2, 3])
})

test('a string pin fixes the axis; a list pin narrows what it rolls among', () => {
  const dice = normalizeDice({ hair: ['bob', 'curls', 'tails'], styling: { values: ['a', 'b', 'c'], draws: 2 } }, 'f.md')!
  assert.deepStrictEqual(rollDice(dice, { hair: 'tails' }).hair, ['tails'])
  for (let i = 0; i < 20; i++) {
    assert.ok(['bob', 'curls'].includes(rollDice(dice, { hair: ['bob', 'curls'] }).hair[0]))
  }
  assert.deepStrictEqual(rollDice(dice, { styling: ['c'] }).styling, ['c'], 'a pin list shorter than draws draws all of it')
})

test('{dice} is filled with one line per axis, or the lines follow the body', () => {
  const roll = { culture: ['Edo Japan'], styling: ['a', 'b'], reveal: [] }
  assert.strictEqual(fillDice('Design:\n{dice}\nGo.', roll), 'Design:\n- culture: Edo Japan\n- styling: a, b\nGo.')
  assert.strictEqual(fillDice('Design.', roll), 'Design.\n\n- culture: Edo Japan\n- styling: a, b')
  assert.strictEqual(fillDice('Design {dice}', undefined), 'Design {dice}')
})

test('{dice} is reserved on an agent that rolls dice; elsewhere it is a slot as before', () => {
  const systemPrompt = 'A {topic} with {dice} and {input}'
  assert.deepStrictEqual(agentSlots({ systemPrompt, dice: { hair: { values: ['bob'], draws: 1 } } }), ['topic', 'input'])
  assert.deepStrictEqual(agentSlots({ systemPrompt }), ['topic', 'dice', 'input'])
  assert.deepStrictEqual(promptSlots(systemPrompt), ['topic', 'dice', 'input'])
})

test('request pins map declared axes to a value or a list of them', () => {
  const agent = { slug: 'a', dice: normalizeDice({ hair: ['bob'], culture: ['x'] }, 'a.md') } as AgentDef
  const chain = { slug: 'c', name: 'c', description: '', filePath: '', edges: [], nodes: [{ id: 'n', kind: 'agent', agent: 'a' }] } as ChainDef
  const defs = { agents: [agent], chains: [] }
  assert.deepStrictEqual(readDicePins(undefined, chain, defs), {})
  assert.deepStrictEqual(readDicePins({ hair: 'bob', culture: ['a', 'b'] }, chain, defs), { pins: { hair: 'bob', culture: ['a', 'b'] } })
  for (const bad of ['bob', null, ['bob'], { hair: 5 }, { hair: [] }, { hair: [1] }]) {
    const res = readDicePins(bad, chain, defs)
    assert.ok('error' in res && /dice must map/.test(res.error), JSON.stringify(bad))
  }
  const undeclared = readDicePins({ tail: 'long' }, chain, defs)
  assert.ok('error' in undeclared && undeclared.status === 400 && /"tail"/.test(undeclared.error))
})
