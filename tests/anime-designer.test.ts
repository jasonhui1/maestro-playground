import { test } from 'vitest'
import assert from 'node:assert'
import path from 'path'
import { loadWorkspace } from '../lib/fs/workspace'
import { rollDice, fillDice } from '../lib/dice'
import { agentSlots } from '../lib/tokens'
import { injectSkills } from '../lib/prompt'
import { extractSections } from '../lib/graph'
import type { AgentDef } from '../lib/types'

// The real agent file, through the real loader (#154).
const REAL_WORKSPACE = path.resolve(__dirname, '../workspace')

function designer() {
  const ws = loadWorkspace(REAL_WORKSPACE)
  const agent = ws.agents.find(a => a.slug === 'anime-designer')
  assert.ok(agent, 'anime-designer is addressable')
  return { ws, agent }
}

// The loader adds `output`, the whole reply; the rest are sections.
const sectionOutputs = (agent: AgentDef) => agent.outputs.map(o => o.name).filter(n => n !== 'output')

const rolledPrompt = (agent: AgentDef) => fillDice(agent.systemPrompt, rollDice(agent.dice!))

test('rolls the recipe\'s axes with the recipe\'s draw counts', () => {
  const { agent } = designer()
  const axes = Object.keys(agent.dice ?? {})
  assert.deepStrictEqual(axes, [
    'culture', 'role', 'outfit', 'length', 'top', 'footwear', 'legwear', 'motif', 'occasion',
    'signature', 'weapon kind', 'weapon size', 'weapon use', 'asymmetry', 'styling', 'reveal', 'unreal',
    'hair', 'build', 'feature', 'expression', 'pose',
    'palette', 'material', 'accent', 'wear',
  ])
  assert.deepStrictEqual(agent.dice!.styling.draws, [1, 2])
  assert.deepStrictEqual(agent.dice!.reveal.draws, [1, 2])
  assert.strictEqual(agent.dice!.culture.values.length, 25)
})

test('takes no input: the roll is the whole prompt', () => {
  const { agent } = designer()
  assert.deepStrictEqual(agentSlots(agent), [])
})

test('outputs the look for the illustrator', () => {
  const { agent } = designer()
  assert.deepStrictEqual(sectionOutputs(agent), ['character', 'clothes'])
})

test('every roll fills {dice} with one line per axis, none left as a token', () => {
  const { agent } = designer()
  const prompt = rolledPrompt(agent)
  assert.ok(!prompt.includes('{dice}'))
  for (const [axis, { fits }] of Object.entries(agent.dice!)) {
    if (!fits) assert.match(prompt, new RegExp(`^- ${axis}: .+$`, 'm'))
  }
})

test('only a fighting role is handed a weapon, as its kind, size and use', () => {
  const { agent } = designer()
  const knight = fillDice(agent.systemPrompt, rollDice(agent.dice!, { role: 'knight' }))
  for (const axis of ['weapon kind', 'weapon size', 'weapon use']) assert.match(knight, new RegExp(`^- ${axis}: .+$`, 'm'))
  assert.doesNotMatch(fillDice(agent.systemPrompt, rollDice(agent.dice!, { role: 'chef' })), /^- weapon (kind|size|use): /m)
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
