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
  const wp = fs.mkdtempSync(path.join(os.tmpdir(), 'run-versions-'))
  process.env.WORKSPACE_PATH = wp
  return wp
}

/** chain → context node + agent node + subchain node; the inner chain holds one more agent. */
function seedWorkspace() {
  const wp = newWorkspace()
  write(wp, 'defaults.md', `---\nmodel: test/model\n---\n`)
  write(wp, 'agents/panel-member.md',
    `---\nname: Panel Member\nskills:\n  - Red Teaming\ntools:\n  - Retrieve\n---\nPanel body\n`)
  write(wp, 'agents/scorer.md', `---\nname: Scorer\n---\nScorer body\n`)
  write(wp, 'agents/unused.md', `---\nname: Unused\n---\nUnused body\n`)
  write(wp, 'skills/base-protocol.md', `---\nname: Base Protocol\ninjected: always\n---\nAlways on\n`)
  write(wp, 'skills/red-teaming.md', `---\nname: Red Teaming\n---\nRed team\n`)
  write(wp, 'skills/idle.md', `---\nname: Idle\n---\nIdle\n`)
  write(wp, 'tools/retrieve.md', `---\nname: Retrieve\nexecutor: retrieve\n---\nRetrieve docs\n`)
  write(wp, 'context/tavern-lore.md', `Tavern lore\n`)
  write(wp, 'context/unread.md', `Unread\n`)
  write(wp, 'chains/scoring.md',
    `---\nname: Scoring\nnodes:\n  - id: s\n    kind: agent\n    agent: scorer\nedges: []\n---\n`)
  write(wp, 'chains/decision-panel.md',
    `---\nname: Decision Panel\nnodes:\n` +
    `  - id: ctx\n    kind: context\n    file: tavern-lore\n` +
    `  - id: panel\n    kind: agent\n    agent: panel-member\n` +
    `  - id: sub\n    kind: subchain\n    subchain: scoring\nedges: []\n---\n`)
  return wp
}

async function load() {
  const ws = await import('../lib/fs/workspace')
  const rv = await import('../lib/runVersions')
  return { ws, rv }
}

test('the walk pins every file the graph reaches, and nothing else', async () => {
  seedWorkspace()
  const { ws, rv } = await load()
  const workspace = ws.loadWorkspace()
  const chain = workspace.chains.find(c => c.slug === 'decision-panel')!

  const touched = rv.collectTouchedFiles(chain, workspace)

  assert.deepStrictEqual(new Set(touched.keys()), new Set([
    'chain/decision-panel', 'chain/scoring',
    'agent/panel-member', 'agent/scorer',
    'skill/base-protocol', 'skill/red-teaming',
    'tool/retrieve',
    'context/tavern-lore',
    'defaults',
  ]))
})

test('a touched file carries its raw bytes, frontmatter included', async () => {
  seedWorkspace()
  const { ws, rv } = await load()
  const workspace = ws.loadWorkspace()
  const chain = workspace.chains.find(c => c.slug === 'decision-panel')!

  const agent = rv.collectTouchedFiles(chain, workspace).get('agent/panel-member')!
  assert.strictEqual(agent.type, 'agent')
  assert.strictEqual(agent.slug, 'panel-member')
  assert.ok(agent.content.includes('name: Panel Member'), 'frontmatter is part of the hashed bytes')
  assert.ok(agent.content.includes('Panel body'))
})

test('a call-site skills! marker decides which skills the walk reaches', async () => {
  const wp = seedWorkspace()
  write(wp, 'chains/decision-panel.md',
    `---\nname: Decision Panel\nnodes:\n` +
    `  - id: panel\n    kind: agent\n    agent: panel-member\n    skills!:\n      - Idle\nedges: []\n---\n`)
  const { ws, rv } = await load()
  const workspace = ws.loadWorkspace()
  const chain = workspace.chains.find(c => c.slug === 'decision-panel')!

  const keys = new Set(rv.collectTouchedFiles(chain, workspace).keys())
  assert.ok(keys.has('skill/idle'), 'the override is reached')
  assert.ok(!keys.has('skill/red-teaming'), 'the file-declared skill is not')
  assert.ok(keys.has('skill/base-protocol'), 'an always-injected skill is reached regardless')
})

test('a subchain cycle terminates', async () => {
  const wp = seedWorkspace()
  write(wp, 'chains/scoring.md',
    `---\nname: Scoring\nnodes:\n  - id: back\n    kind: subchain\n    subchain: decision-panel\nedges: []\n---\n`)
  const { ws, rv } = await load()
  const workspace = ws.loadWorkspace()
  const chain = workspace.chains.find(c => c.slug === 'decision-panel')!

  const keys = new Set(rv.collectTouchedFiles(chain, workspace).keys())
  assert.ok(keys.has('chain/decision-panel') && keys.has('chain/scoring'))
})

test('an agent run pins the agent but no chain file', async () => {
  seedWorkspace()
  const { ws, rv } = await load()
  const workspace = ws.loadWorkspace()
  const { resolveRunChain } = await import('../lib/resolveRunChain')
  const resolved = resolveRunChain({ agentName: 'Panel Member' }, workspace)
  assert.ok('chain' in resolved)

  const keys = new Set(rv.collectTouchedFiles(resolved.chain, workspace).keys())
  assert.ok(keys.has('agent/panel-member'))
  assert.ok(![...keys].some(k => k.startsWith('chain/')), 'an in-memory chain has no file to pin')
})

test('parseVersionKey inverts versionKey, including the bare defaults key', async () => {
  const { rv } = await load()
  assert.deepStrictEqual(rv.parseVersionKey('agent/panel-member'), { type: 'agent', slug: 'panel-member' })
  assert.deepStrictEqual(rv.parseVersionKey('defaults'), { type: 'defaults', slug: '' })
})

test('pinning writes one version per touched file, and repeats it unchanged', async () => {
  const wp = seedWorkspace()
  const { ws, rv } = await load()
  const workspace = ws.loadWorkspace()
  const chain = workspace.chains.find(c => c.slug === 'decision-panel')!

  const first = rv.pinRunVersions(chain, workspace)
  assert.strictEqual(first['agent/panel-member'], 1)
  assert.strictEqual(first['defaults'], 1)

  const second = rv.pinRunVersions(chain, ws.loadWorkspace())
  assert.deepStrictEqual(second, first, 'an unchanged file keeps its number')
  assert.deepStrictEqual(
    fs.readdirSync(path.join(wp, '.versions', 'agent', 'panel-member')).sort(),
    ['index.json', 'v1.md'],
    'an unchanged file adds no version file',
  )
})

test('a frontmatter-only edit produces a new version', async () => {
  const wp = seedWorkspace()
  const { ws, rv } = await load()
  const chain0 = ws.loadWorkspace().chains.find(c => c.slug === 'decision-panel')!
  rv.pinRunVersions(chain0, ws.loadWorkspace())

  write(wp, 'agents/panel-member.md',
    `---\nname: Panel Member\nmodel: other/model\nskills:\n  - Red Teaming\ntools:\n  - Retrieve\n---\nPanel body\n`)
  const workspace = ws.loadWorkspace()
  const chain = workspace.chains.find(c => c.slug === 'decision-panel')!

  const pinned = rv.pinRunVersions(chain, workspace)
  assert.strictEqual(pinned['agent/panel-member'], 2)
  assert.strictEqual(pinned['agent/scorer'], 1, 'an untouched-by-the-edit file stays put')
})
