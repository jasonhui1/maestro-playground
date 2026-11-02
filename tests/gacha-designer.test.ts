import { test } from 'vitest'
import assert from 'node:assert'
import path from 'path'
import { loadWorkspace } from '../lib/fs/workspace'
import { rollDice, fillDice } from '../lib/dice'
import { agentSlots } from '../lib/tokens'
import { injectSkills } from '../lib/prompt'
import { extractSections } from '../lib/graph'
import type { AgentDef } from '../lib/types'

// The real agent file, through the real loader.
const REAL_WORKSPACE = path.resolve(__dirname, '../workspace')

function designer() {
  const ws = loadWorkspace(REAL_WORKSPACE)
  const agent = ws.agents.find(a => a.slug === 'gacha-designer')
  assert.ok(agent, 'gacha-designer is addressable')
  return { ws, agent }
}

// The loader adds `output`, the whole reply; the rest are sections.
const sectionOutputs = (agent: AgentDef) => agent.outputs.map(o => o.name).filter(n => n !== 'output')

const rolledPrompt = (agent: AgentDef, pins = {}) => fillDice(agent.systemPrompt, rollDice(agent.dice!, pins))

const R = '★3 (R)', SR = '★4 (SR)', SSR = '★5 (SSR)'
const GROUNDED = 'grounded: nothing breaks physics, the drama comes from shape and styling'

test('rolls the recipe\'s axes with the recipe\'s draw counts', () => {
  const { agent } = designer()
  const axes = Object.keys(agent.dice ?? {})
  assert.deepStrictEqual(axes, [
    'star', 'culture', 'role', 'archetype', 'moment', 'outfit', 'length', 'top', 'footwear', 'legwear', 'motif', 'occasion',
    'signature', 'weapon kind', 'weapon size', 'weapon use', 'asymmetry', 'styling', 'extra styling', 'reveal', 'unreal',
    'hair', 'build', 'feature', 'pose mode', 'pose level',
    'palette', 'material', 'accent', 'showpiece', 'wear',
  ])
  assert.strictEqual(agent.dice!.styling.draws, 1)
  assert.deepStrictEqual(agent.dice!.reveal.draws, [1, 2])
})

test('takes no input: the roll is the whole prompt', () => {
  const { agent } = designer()
  assert.deepStrictEqual(agentSlots(agent), [])
})

test('outputs the look for the illustrator', () => {
  const { agent } = designer()
  assert.deepStrictEqual(sectionOutputs(agent), ['character', 'clothes'])
})

test('a ★5 card rolls rare and a ★4 uncommon', () => {
  const { agent } = designer()
  assert.deepStrictEqual(agent.dice!.star.rarity, { [SR]: 'uncommon', [SSR]: 'rare' })
})

test('every roll fills {dice} with one line per ungated axis, none left as a token', () => {
  const { agent } = designer()
  const prompt = rolledPrompt(agent)
  assert.ok(!prompt.includes('{dice}'))
  for (const [axis, { fits }] of Object.entries(agent.dice!)) {
    if (!fits) assert.match(prompt, new RegExp(`^- ${axis}: .+$`, 'm'))
  }
})

test('a ★3 card is plain: one styling item, symmetric, grounded, no accent, no showpiece', () => {
  const { agent } = designer()
  for (let i = 0; i < 50; i++) {
    const roll = rollDice(agent.dice!, { star: R })
    assert.deepStrictEqual(roll['extra styling'], [])
    assert.deepStrictEqual(roll.showpiece, [])
    assert.deepStrictEqual(roll.asymmetry, ['none: keep her symmetric'])
    assert.deepStrictEqual(roll.unreal, [GROUNDED])
    assert.deepStrictEqual(roll.accent, ['none'])
  }
  assert.doesNotMatch(rolledPrompt(agent, { star: R }), /^- (extra styling|showpiece): /m)
})

test('a ★5 card always breaks reality, carries an accent and places a showpiece', () => {
  const { agent } = designer()
  for (let i = 0; i < 50; i++) {
    const roll = rollDice(agent.dice!, { star: SSR })
    assert.strictEqual(roll['extra styling'].length, 1)
    assert.strictEqual(roll.showpiece.length, 1)
    assert.notDeepStrictEqual(roll.unreal, [GROUNDED])
    assert.notDeepStrictEqual(roll.accent, ['none'])
  }
})

test('only a fighting role is handed a weapon, as its kind, size and use', () => {
  const { agent } = designer()
  const knight = rolledPrompt(agent, { role: 'knight' })
  for (const axis of ['weapon kind', 'weapon size', 'weapon use']) assert.match(knight, new RegExp(`^- ${axis}: .+$`, 'm'))
  assert.doesNotMatch(rolledPrompt(agent, { role: 'chef' }), /^- weapon (kind|size|use): /m)
})

test('her face and pose are chosen by the designer from rolled qualities, never handed to her', () => {
  const { agent } = designer()
  for (const axis of ['expression', 'pose', 'pose energy']) assert.ok(!(axis in agent.dice!), `${axis} is not rolled`)
  assert.match(agent.systemPrompt, /Start from culture, role, archetype, motif and occasion/)
})

test('the base-protocol Summary follows the asked sections, so character and clothes stay sections', () => {
  const { ws, agent } = designer()
  const sys = injectSkills(agent, ws.skills, rolledPrompt(agent))
  assert.match(sys, /`## Summary` section/)
  const asked = ['title', 'core-idea', 'character', 'clothes', 'pose']
  assert.deepStrictEqual(extractSections(agent.systemPrompt).filter(s => asked.includes(s)), asked)
  const reply = asked.map(s => `## ${s}\nbody`).join('\n\n') + '\n\n## Summary\n- a'
  const sections = extractSections(reply)
  for (const name of sectionOutputs(agent)) assert.ok(sections.includes(name), `${name} is a section of the reply`)
})
