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
  const wp = fs.mkdtempSync(path.join(os.tmpdir(), 'ws-delete-variant-'))
  process.env.WORKSPACE_PATH = wp
  return wp
}

const read = (p: string) => fs.readFileSync(p, 'utf-8')

async function del() {
  return import('../lib/fs/delete')
}

const PREMORTEM = [
  '---',
  'name: Premortem',
  'variants:',
  '  - id: rot',
  '    skills+:',
  '      - cause-technical',
  '  - id: burnout',
  '    skills+:',
  '      - cause-motivation',
  '---',
  'Write the post-mortem.',
  '',
].join('\n')

const ONE_VARIANT = [
  '---',
  'name: Premortem',
  'variants:',
  '  - id: rot',
  '---',
  'Write the post-mortem.',
  '',
].join('\n')

function chainNaming(...agents: string[]) {
  return [
    '---',
    'name: Decision',
    'nodes:',
    ...agents.flatMap((a, i) => [`  - id: n${i}`, '    kind: agent', `    agent: ${a}`]),
    'edges: []',
    '---',
    '',
  ].join('\n')
}

test('deleting a variant drops its entry from the declaring file and touches nothing else', async () => {
  const wp = newWorkspace()
  const agentPath = write(wp, 'agents/premortem.md', PREMORTEM)
  const chainPath = write(wp, 'chains/decision.md', chainNaming('burnout'))
  const chainBefore = read(chainPath)

  const { deleteWorkspaceEntity } = await del()
  const result = deleteWorkspaceEntity('agent', 'rot')

  assert.strictEqual(result.filePath, agentPath, 'a variant has no file of its own to unlink')
  assert.ok(fs.existsSync(agentPath))

  const agent = read(agentPath)
  assert.ok(!agent.includes('id: rot'))
  assert.ok(agent.includes('id: burnout'), 'the sibling variant is untouched')
  assert.ok(agent.includes('cause-motivation'), 'and keeps its own fields')
  assert.ok(agent.includes('Write the post-mortem.'), 'the shared body is untouched')
  assert.strictEqual(read(chainPath), chainBefore)

  const { loadWorkspace } = await import('../lib/fs/workspace')
  assert.deepStrictEqual(loadWorkspace().agents.map(a => a.slug), ['burnout'])
})

test('deleting the last variant leaves the file addressable by its own name (ADR-0014)', async () => {
  const wp = newWorkspace()
  const agentPath = write(wp, 'agents/panel/premortem.md', ONE_VARIANT)

  const { deleteWorkspaceEntity } = await del()
  const result = deleteWorkspaceEntity('agent', 'rot')

  assert.strictEqual(result.plan.promotes, 'premortem')
  assert.ok(fs.existsSync(agentPath), 'the file and its prompt body survive')

  const agent = read(agentPath)
  assert.ok(!agent.includes('variants'), 'the empty block is dropped, not left as an empty list')
  assert.ok(agent.includes('Write the post-mortem.'))

  const { loadWorkspace } = await import('../lib/fs/workspace')
  assert.deepStrictEqual(loadWorkspace().agents.map(a => a.slug), ['premortem'])
})

test('promotion is refused when the file name is already taken by another variant', async () => {
  const wp = newWorkspace()
  const agentPath = write(wp, 'agents/premortem.md', ONE_VARIANT)
  write(wp, 'agents/panel.md', '---\nname: Panel\nvariants:\n  - id: premortem\n---\nbody\n')

  const { deleteWorkspaceEntity } = await del()
  assert.throws(() => deleteWorkspaceEntity('agent', 'rot'), (err: Error) =>
    /already exists/.test(err.message) && err.message.includes('panel.md'))
  assert.strictEqual(read(agentPath), ONE_VARIANT, 'the refused delete wrote nothing')
})

test('deleting a variant is refused while a chain names it, and the refusal names the chain', async () => {
  const wp = newWorkspace()
  const agentPath = write(wp, 'agents/premortem.md', PREMORTEM)
  write(wp, 'chains/decision.md', chainNaming('rot', 'burnout'))

  const { deleteWorkspaceEntity, planDelete } = await del()
  assert.throws(() => deleteWorkspaceEntity('agent', 'rot'), (err: Error) =>
    err.message.startsWith('In use') && err.message.includes('rot') && err.message.includes('decision (chain)'))

  assert.strictEqual(read(agentPath), PREMORTEM)
  assert.deepStrictEqual(planDelete('agent', 'rot').blockers.map(b => b.name), ['rot'])
})

test('deleting a file that declares variants removes the file and every variant it declared', async () => {
  const wp = newWorkspace()
  const agentPath = write(wp, 'agents/premortem.md', PREMORTEM)

  const { deleteWorkspaceEntity } = await del()
  const result = deleteWorkspaceEntity('agent', 'premortem')

  assert.ok(!fs.existsSync(agentPath))
  assert.deepStrictEqual(result.plan.removed, ['rot', 'burnout'])

  const { loadWorkspace } = await import('../lib/fs/workspace')
  assert.deepStrictEqual(loadWorkspace().agents, [])
})

test('deleting a declaring file is refused for a chain naming any variant, not its own name', async () => {
  const wp = newWorkspace()
  write(wp, 'agents/premortem.md', PREMORTEM)
  write(wp, 'chains/decision.md', chainNaming('burnout'))

  const { deleteWorkspaceEntity } = await del()
  // The file's own name addresses no chain (ADR-0013), so the block comes from the variant.
  assert.throws(() => deleteWorkspaceEntity('agent', 'premortem'), (err: Error) =>
    err.message.startsWith('In use') && err.message.includes('burnout'))
})

test('deleting an ordinary file is refused while a chain names it (#63)', async () => {
  const wp = newWorkspace()
  const agentPath = write(wp, 'agents/optimist.md', '---\nname: Optimist\n---\nbody\n')
  write(wp, 'chains/decision.md', chainNaming('optimist'))

  const { deleteWorkspaceEntity } = await del()
  assert.throws(() => deleteWorkspaceEntity('agent', 'optimist'), (err: Error) =>
    err.message.startsWith('In use') && err.message.includes('decision (chain)'))
  assert.ok(fs.existsSync(agentPath))
})

test('a skill an agent lists is refused too — every typed reference site counts', async () => {
  const wp = newWorkspace()
  const skillPath = write(wp, 'skills/concise.md', '---\nname: concise\n---\nBe brief.\n')
  write(wp, 'agents/optimist.md', '---\nname: Optimist\nskills:\n  - concise\n---\nbody\n')

  const { deleteWorkspaceEntity } = await del()
  assert.throws(() => deleteWorkspaceEntity('skill', 'concise'), (err: Error) =>
    err.message.startsWith('In use') && err.message.includes('optimist (agent)'))
  assert.ok(fs.existsSync(skillPath))
})

test('an unreferenced file still deletes, and a missing name reports not found', async () => {
  const wp = newWorkspace()
  const agentPath = write(wp, 'agents/optimist.md', '---\nname: Optimist\n---\nbody\n')

  const { deleteWorkspaceEntity } = await del()
  assert.deepStrictEqual(deleteWorkspaceEntity('agent', 'optimist').success, true)
  assert.ok(!fs.existsSync(agentPath))
  assert.throws(() => deleteWorkspaceEntity('agent', 'optimist'), /not found/)
  assert.throws(() => deleteWorkspaceEntity('skill', 'nothing'), /not found/)
})
