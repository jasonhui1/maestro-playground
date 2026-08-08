import { test, afterEach } from 'vitest'
import assert from 'node:assert'
import fs from 'fs'
import path from 'path'
import os from 'os'

const ORIGINAL_WORKSPACE = process.env.WORKSPACE_PATH

afterEach(() => {
  if (ORIGINAL_WORKSPACE === undefined) delete process.env.WORKSPACE_PATH
  else process.env.WORKSPACE_PATH = ORIGINAL_WORKSPACE
})

function write(root: string, rel: string, body: string) {
  const p = path.join(root, rel)
  fs.mkdirSync(path.dirname(p), { recursive: true })
  fs.writeFileSync(p, body)
  return p
}

function newWorkspace() {
  const wp = fs.mkdtempSync(path.join(os.tmpdir(), 'ws-defaults-'))
  process.env.WORKSPACE_PATH = wp
  return wp
}

const DEFAULTS = `---
model: defaults/model
input_from: user
output_format: markdown
outputs:
  - summary
---
`

async function agentsOf() {
  const { loadWorkspace } = await import('../lib/fs/workspace')
  return loadWorkspace().agents
}

test('the defaults file supplies every field the agent file omits', async () => {
  const wp = newWorkspace()
  write(wp, 'defaults.md', DEFAULTS)
  write(wp, 'agents/triage.md', '---\nname: triage\nskills:\n  - base-protocol\n---\nClassify {input}.\n')

  const [a] = await agentsOf()
  assert.strictEqual(a.model, 'defaults/model')
  assert.strictEqual(a.input_from, 'user')
  assert.strictEqual(a.output_format, 'markdown')
  assert.deepStrictEqual(a.outputs, [{ name: 'output' }, { name: 'summary' }])
  // the body always comes from the agent file
  assert.strictEqual(a.systemPrompt, 'Classify {input}.')
  assert.deepStrictEqual(a.skills, ['base-protocol'])
})

test('an agent field overrides the default field, per field, with no deep merge', async () => {
  const wp = newWorkspace()
  write(wp, 'defaults.md', '---\nmodel: defaults/model\nskills:\n  - base-protocol\n  - concise\noutputs:\n  - summary\n---\n')
  write(wp, 'agents/triage.md', '---\nname: triage\nmodel: own/model\nskills:\n  - red-teaming\n---\nbody\n')

  const [a] = await agentsOf()
  assert.strictEqual(a.model, 'own/model')
  // the default list is gone, not extended
  assert.deepStrictEqual(a.skills, ['red-teaming'])
  // a field the agent file leaves alone still comes from defaults
  assert.deepStrictEqual(a.outputs, [{ name: 'output' }, { name: 'summary' }])
})

test('a workspace with no defaults file behaves exactly as it does today', async () => {
  const wp = newWorkspace()
  write(wp, 'agents/triage.md', '---\nname: triage\nmodel: own/model\n---\nbody\n')

  const [a] = await agentsOf()
  assert.strictEqual(a.model, 'own/model')
  assert.strictEqual(a.input_from, 'user')
  assert.strictEqual(a.output_format, 'markdown')
  assert.deepStrictEqual(a.outputs, [{ name: 'output' }])
})

test('a field stated with no value reads as omitted, not as an override', async () => {
  const wp = newWorkspace()
  write(wp, 'defaults.md', DEFAULTS)
  write(wp, 'agents/triage.md', '---\nname: triage\nmodel:\n---\nbody\n')

  const [a] = await agentsOf()
  assert.strictEqual(a.model, 'defaults/model')
  assert.strictEqual(a.resolution?.sources.model, 'defaults')
})

test('an agent node draws the output sockets its defaults file declares', async () => {
  const wp = newWorkspace()
  write(wp, 'defaults.md', DEFAULTS)
  write(wp, 'agents/triage.md', '---\nname: triage\n---\nClassify {input}.\n')
  write(wp, 'chains/decision.md', '---\nname: Decision\nnodes:\n  - id: t\n    kind: agent\n    agent: triage\nedges: []\n---\n')

  const { loadWorkspace } = await import('../lib/fs/workspace')
  const ws = loadWorkspace()
  const { kindOf } = await import('../lib/nodeKinds')
  const node = ws.chains[0].nodes[0]
  const lookup = { chain: ws.chains[0], agents: ws.agents, chains: ws.chains }

  assert.deepStrictEqual(kindOf('agent').outputs(node, lookup), ['output', 'summary'])
  assert.deepStrictEqual(kindOf('agent').inputs(node, lookup).map(i => i.name), ['input'])
})

test('the resolved agent records which file each field came from', async () => {
  const wp = newWorkspace()
  write(wp, 'defaults.md', DEFAULTS)
  write(wp, 'agents/triage.md', '---\nname: triage\nmodel: own/model\n---\nbody\n')

  const [a] = await agentsOf()
  assert.strictEqual(a.resolution?.sources.model, 'file')
  assert.strictEqual(a.resolution?.sources.outputs, 'defaults')
  assert.strictEqual(a.resolution?.sources.name, 'file')
  // stated nowhere: the parser's own fallback
  assert.strictEqual(a.resolution?.sources.skills, 'built-in')
})

test('an agent file may not name a parent, and may not extend', async () => {
  const { validateAgentFrontmatter } = await import('../lib/fs/validate')

  assert.strictEqual(validateAgentFrontmatter({ name: 'triage' }).valid, true)

  const parent = validateAgentFrontmatter({ name: 'triage', parent: 'base' })
  assert.strictEqual(parent.valid, false)
  assert.ok(parent.error?.includes('parent'))

  const extend = validateAgentFrontmatter({ name: 'triage', extends: 'base' })
  assert.strictEqual(extend.valid, false)
  assert.ok(extend.error?.includes('extends'))
})

test('a chain using an agent that names a parent fails validation', async () => {
  const wp = newWorkspace()
  write(wp, 'defaults.md', DEFAULTS)
  write(wp, 'agents/triage.md', '---\nname: triage\nparent: base\n---\nbody\n')
  write(wp, 'chains/decision.md', '---\nname: Decision\nnodes:\n  - id: t\n    kind: agent\n    agent: triage\nedges: []\n---\n')

  const { loadWorkspace } = await import('../lib/fs/workspace')
  const ws = loadWorkspace()
  const { validateChain } = await import('../lib/chainGraph')
  const result = validateChain(ws.chains[0], ws.agents, ws.chains)

  assert.strictEqual(result.valid, false)
  assert.ok(result.errors.some(e => e.includes('parent')), result.errors.join('\n'))
})
