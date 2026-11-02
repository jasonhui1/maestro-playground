import { test } from 'vitest'
import assert from 'node:assert'
import { normalizeDice, rollDice, fillDice, readDicePins, rollRunDice } from '../lib/dice'
import { agentSlots, promptSlots } from '../lib/tokens'
import { validateChain } from '../lib/chainGraph'
import { parseAgent } from '../lib/fs/parseAgent'
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
  assert.deepStrictEqual(rollDice(dice, {}, { random: alwaysFirst }), { styling: ['a', 'b'], hair: ['bob'] })
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

test('a value map gives each value a rarity; common rolls about four times as often as rare', () => {
  const dice = normalizeDice({ weapon: { values: { lance: { rarity: 'rare' }, sword: null, bow: { rarity: 'uncommon' } } } }, 'f.md')!
  assert.deepStrictEqual(dice.weapon.values, ['lance', 'sword', 'bow'])
  assert.deepStrictEqual(dice.weapon.rarity, { lance: 'rare', bow: 'uncommon' })
  const tally: Record<string, number> = { lance: 0, sword: 0, bow: 0 }
  for (let i = 0; i < 7000; i++) tally[rollDice(dice).weapon[0]]++
  assert.ok(tally.sword > tally.bow * 1.5 && tally.bow > tally.lance * 1.5, JSON.stringify(tally))
})

test('a `by` axis rolls only among the values that fit what its axis drew, and nothing when none fit', () => {
  const dice = normalizeDice({
    role: ['knight', 'thief', 'chef'],
    weapon: { by: 'role', values: { lance: { fits: ['knight'] }, 'sword cane': { fits: ['thief', 'knight'] } } },
  }, 'f.md')!
  assert.deepStrictEqual(dice.weapon.fits, { by: 'role', values: { lance: ['knight'], 'sword cane': ['thief', 'knight'] } })
  for (let i = 0; i < 20; i++) assert.deepStrictEqual(rollDice(dice, { role: 'thief' }).weapon, ['sword cane'])
  assert.deepStrictEqual(rollDice(dice, { role: 'chef' }).weapon, [])
  assert.deepStrictEqual(rollDice(dice, { role: 'samurai' }).weapon, [], 'a pinned value the axis does not list fits nothing')
  assert.deepStrictEqual(rollDice(dice, { role: 'chef', weapon: 'lance' }).weapon, ['lance'], 'a pin is asked for, not rolled')
  assert.strictEqual(fillDice('{dice}', rollDice(dice, { role: 'chef' })), '- role: chef')
})

test('a malformed value map or `by` throws naming the file and axis', () => {
  const weapon = (decl: unknown) => normalizeDice({ role: ['knight', 'chef'], weapon: decl }, 'f.md')
  assert.throws(() => weapon({ values: { lance: { rarity: 'legendary' } } }), /f\.md: dice axis "weapon" value "lance" rarity must be common, uncommon or rare/)
  assert.throws(() => weapon({ values: { lance: { colour: 'red' } } }), /axis "weapon" value "lance" may state only fits and rarity/)
  assert.throws(() => weapon({ values: { lance: { fits: ['knight'] } } }), /axis "weapon" value "lance" fits needs the axis's by/)
  assert.throws(() => weapon({ by: 'role', values: { lance: { fits: [] } } }), /axis "weapon" value "lance" fits must list/)
  assert.throws(() => weapon({ by: 'role', values: { lance: { fits: ['knigth'] } } }), /axis "weapon" value "lance" fits "knigth", which "role" does not roll/)
  assert.throws(() => normalizeDice({ role: { by: 'role', values: { knight: null } } }, 'f.md'), /axis "role" by names "role", which is itself/)
  assert.throws(() => normalizeDice({
    weapon: { by: 'grip', values: { lance: { fits: ['two-handed'] } } },
    grip: { by: 'weapon', values: { 'two-handed': { fits: ['lance'] } } },
  }, 'f.md'), /axis "weapon" by names "grip", whose by leads back to "weapon"/)
})

test('a `by` may name an axis that has a `by` of its own; each rolls after the one it names', () => {
  // Declared last-first, so declaration order alone would roll grip before weapon.
  const dice = normalizeDice({
    grip: { by: 'weapon', values: { 'two-handed': { fits: ['lance'] }, 'one-handed': { fits: ['dagger'] } } },
    weapon: { by: 'role', values: { lance: { fits: ['knight'] }, dagger: { fits: ['thief'] } } },
    role: ['knight', 'thief'],
  }, 'f.md')!
  for (let i = 0; i < 20; i++) {
    assert.deepStrictEqual(rollDice(dice, { role: 'knight' }), { grip: ['two-handed'], weapon: ['lance'], role: ['knight'] })
    assert.deepStrictEqual(rollDice(dice, { role: 'thief' }).grip, ['one-handed'])
  }
})

test('a `by` naming an axis the block does not declare loads, left for a chain to wire in (#161)', () => {
  const dice = normalizeDice({
    longing: ['flying'],
    'unreal origin': { by: 'unreal', fits: ['halo'], values: { 'a city shares it': null, 'half of a pair': { fits: ['crown'] } } },
  }, 'f.md')!
  assert.deepStrictEqual(dice['unreal origin'].fits, { by: 'unreal', values: { 'a city shares it': ['halo'], 'half of a pair': ['crown'] } })
  assert.deepStrictEqual(rollDice(dice, {}, { random: alwaysFirst }), { longing: ['flying'], 'unreal origin': [] }, 'nothing wired in, nothing fits')
})

// The profile is listed first, so its roll can only see the designer's if the designer rolls first.
const wiredDefs = {
  agents: [
    { slug: 'designer', dice: normalizeDice({ role: ['knight', 'thief', 'chef'] }, 'designer.md') },
    { slug: 'profile', dice: normalizeDice({ weapon: { by: 'role', values: { lance: { fits: ['knight'] }, 'sword cane': { fits: ['thief'] } } } }, 'profile.md') },
  ] as AgentDef[],
  chains: [],
}
const wiredChain = (edges: ChainDef['edges']) => ({
  slug: 'c', name: 'c', description: '', filePath: '', edges,
  nodes: [{ id: 'profile', kind: 'agent', agent: 'profile' }, { id: 'designer', kind: 'agent', agent: 'designer' }],
}) as ChainDef
const diceEdge = { fromNode: 'designer', fromSocket: 'dice', toNode: 'profile', toSocket: 'design' }

test('a node rolls its `by` against the roll wired into its dice socket (#161)', () => {
  const chain = wiredChain([diceEdge])
  for (let i = 0; i < 20; i++) assert.deepStrictEqual(rollRunDice(chain, wiredDefs, {}, { role: 'thief' }).profile.weapon, ['sword cane'])
  assert.deepStrictEqual(rollRunDice(chain, wiredDefs, {}, { role: 'chef' }).profile.weapon, [])
  assert.deepStrictEqual(rollRunDice(chain, wiredDefs, { designer: { role: ['knight'] } }).profile.weapon, ['lance'], 'a pinned roll is the one wired in')
  assert.deepStrictEqual(rollRunDice(wiredChain([]), wiredDefs, {}, { role: 'knight' }).profile.weapon, [], 'nothing wired in, nothing fits')
})

test('a dice node offers a dice socket; a chain checks every `by` it leaves to the wiring (#161)', () => {
  const agent = (slug: string, systemPrompt: string, dice?: unknown) =>
    ({ slug, name: slug, systemPrompt, skills: [], outputs: [], dice: normalizeDice(dice, `${slug}.md`) }) as unknown as AgentDef
  const agents = [
    agent('designer', 'Design.', { role: ['knight', 'thief'] }),
    agent('judge', 'Judge.'),
    agent('profile', 'From {design} and {other}.', { weapon: { by: 'role', values: { lance: { fits: ['knight'] } } } }),
    agent('typo', 'From {design}.', { weapon: { by: 'role', values: { lance: { fits: ['knigth'] } } } }),
  ]
  const errorsOf = (nodes: [string, string][], edges: [string, string][]) => validateChain({
    slug: 'c', name: 'c', description: '', filePath: '',
    nodes: nodes.map(([id, a]) => ({ id, kind: 'agent', agent: a })),
    edges: edges.map(([from, to]) => {
      const [fromNode, fromSocket] = from.split('.'), [toNode, toSocket] = to.split('.')
      return { fromNode, fromSocket, toNode, toSocket }
    }),
  } as ChainDef, { agents }).errors
  const designerAndProfile: [string, string][] = [['d', 'designer'], ['j', 'judge'], ['p', 'profile']]

  assert.deepStrictEqual(errorsOf(designerAndProfile, [['d.dice', 'p.design'], ['j.output', 'p.other']]), [])
  assert.deepStrictEqual(errorsOf(designerAndProfile, [['j.dice', 'p.design'], ['d.output', 'p.other']]).filter(e => /j\.dice/.test(e)), ['Edge "j.dice": no such output socket'])
  assert.deepStrictEqual(errorsOf(designerAndProfile, [['d.output', 'p.design'], ['j.output', 'p.other']]),
    ['Node "p": dice axis "weapon" rolls by "role", which no node wired into its dice socket rolls; wire one in, or check the axis name'])
  assert.deepStrictEqual(errorsOf([['d', 'designer'], ['e', 'designer'], ['p', 'profile']], [['d.dice', 'p.design'], ['e.dice', 'p.other']]),
    ['Node "p": dice axis "weapon" rolls by "role", which 2 nodes wired into its dice socket roll (d, e); wire in one'])
  assert.deepStrictEqual(errorsOf([['d', 'designer'], ['t', 'typo']], [['d.dice', 't.design']]),
    ['Node "t": dice axis "weapon" value "lance" fits "knigth", which "role" on node "d" does not roll'])
})

test('an agent that rolls dice cannot also declare an output named dice (#161)', () => {
  const file = (outputs: string, dice: string) => `---\nname: A\noutputs: [${outputs}]\n${dice}---\nX\n`
  assert.throws(() => parseAgent('a.md', file('dice', 'dice:\n  hair: [bob]\n')), /a\.md: output "dice" is the socket that carries this agent's dice roll/)
  assert.deepStrictEqual(parseAgent('a.md', file('dice', '')).outputs.map(o => o.name), ['output', 'dice'])
})

test('an axis-level `fits` covers every value that states none of its own', () => {
  const dice = normalizeDice({
    role: ['knight', 'thief', 'chef'],
    size: { by: 'role', fits: ['knight', 'thief'], values: { 'one-handed': null, 'taller than she is': { fits: ['knight'] } } },
  }, 'f.md')!
  assert.deepStrictEqual(dice.size.fits!.values, { 'one-handed': ['knight', 'thief'], 'taller than she is': ['knight'] })
  assert.deepStrictEqual(rollDice(dice, { role: 'chef' }).size, [])
  for (let i = 0; i < 20; i++) assert.deepStrictEqual(rollDice(dice, { role: 'thief' }).size, ['one-handed'])
  assert.deepStrictEqual(normalizeDice({ role: ['knight'], size: { by: 'role', fits: ['knight'], values: ['big'] } }, 'f.md')!.size.fits!.values, { big: ['knight'] })
  assert.throws(() => normalizeDice({ role: ['knight'], size: { fits: ['knight'], values: ['big'] } }, 'f.md'), /axis "size" fits needs the axis's by/)
  assert.throws(() => normalizeDice({ role: ['knight'], size: { by: 'role', fits: [], values: ['big'] } }, 'f.md'), /axis "size" fits must list/)
  assert.throws(() => normalizeDice({ role: ['knight'], size: { by: 'role', fits: ['knigth'], values: ['big'] } }, 'f.md'), /axis "size" value "big" fits "knigth"/)
})
