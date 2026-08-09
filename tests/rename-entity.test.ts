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
  const wp = fs.mkdtempSync(path.join(os.tmpdir(), 'ws-rename-'))
  process.env.WORKSPACE_PATH = wp
  return wp
}

const read = (p: string) => fs.readFileSync(p, 'utf-8')

async function rename() {
  return import('../lib/fs/rename')
}

test('renaming an agent moves the file, keeps its folder, and rewrites the call site', async () => {
  const wp = newWorkspace()
  write(wp, 'agents/panel/panel-optimist.md', '---\nname: Optimist\nmodel: test/model\n---\nbody\n')
  const chainPath = write(
    wp,
    'chains/decision.md',
    '---\nname: Decision\nnodes:\n  - id: a\n    kind: agent\n    agent: panel-optimist\n  - id: b\n    kind: decider\n    agent: panel-optimist\nedges: []\n---\n',
  )

  const { renameWorkspaceEntity } = await rename()
  const result = renameWorkspaceEntity('agent', 'panel-optimist', 'optimist')

  assert.strictEqual(result.filePath, path.join(wp, 'agents', 'panel', 'optimist.md'))
  assert.ok(!fs.existsSync(path.join(wp, 'agents', 'panel', 'panel-optimist.md')))
  assert.ok(read(chainPath).includes('agent: optimist'))
  assert.ok(!read(chainPath).includes('panel-optimist'))

  const { loadWorkspace } = await import('../lib/fs/workspace')
  const ws = loadWorkspace()
  assert.deepStrictEqual(ws.agents.map(a => a.slug), ['optimist'])
  assert.deepStrictEqual(
    ws.chains[0].nodes.map(n => (n.kind === 'agent' || n.kind === 'decider' ? n.agent : null)),
    ['optimist', 'optimist'],
  )
})

test('the .versions directory follows the new slug, so a pinned run still resolves', async () => {
  const wp = newWorkspace()
  write(wp, 'agents/panel-optimist.md', '---\nname: Optimist\n---\nv2 body\n')

  const { snapshotVersion, getVersionContent, listVersions } = await import('../lib/fs/versions')
  snapshotVersion('agent', 'panel-optimist', 'v1 body')
  snapshotVersion('agent', 'panel-optimist', 'v2 body')

  const { renameWorkspaceEntity } = await rename()
  renameWorkspaceEntity('agent', 'panel-optimist', 'optimist')

  assert.ok(!fs.existsSync(path.join(wp, '.versions', 'agent', 'panel-optimist')))
  assert.strictEqual(getVersionContent('agent', 'optimist', 1), 'v1 body')
  assert.strictEqual(getVersionContent('agent', 'optimist', 2), 'v2 body')
  assert.deepStrictEqual(listVersions('agent', 'optimist').map(v => v.version), [2, 1])
})

test('a past run keeps resolving: its pinned key follows the slug, its version number does not', async () => {
  const wp = newWorkspace()
  write(wp, 'agents/panel-optimist.md', '---\nname: Optimist\n---\nbody\n')
  write(
    wp,
    'logs/2026-08-08-abc/meta.json',
    JSON.stringify({
      runId: '2026-08-08-abc',
      chainName: 'decision',
      versions: { 'chain/decision': 1, 'agent/panel-optimist': 3, defaults: 2 },
    }),
  )

  const { snapshotVersion, getVersionContent } = await import('../lib/fs/versions')
  snapshotVersion('agent', 'panel-optimist', 'a')
  snapshotVersion('agent', 'panel-optimist', 'b')
  snapshotVersion('agent', 'panel-optimist', 'the pinned bytes')

  const { planRename, renameWorkspaceEntity } = await rename()
  assert.deepStrictEqual(planRename('agent', 'panel-optimist', 'optimist').runs, ['2026-08-08-abc'])
  renameWorkspaceEntity('agent', 'panel-optimist', 'optimist')

  const meta = JSON.parse(read(path.join(wp, 'logs', '2026-08-08-abc', 'meta.json')))
  assert.deepStrictEqual(meta.versions, { 'chain/decision': 1, 'agent/optimist': 3, defaults: 2 })
  assert.strictEqual(meta.runId, '2026-08-08-abc', 'the rest of the run record is untouched')

  // what the pinned-versions view fetches, for the key the run now holds
  assert.strictEqual(getVersionContent('agent', 'optimist', meta.versions['agent/optimist']), 'the pinned bytes')
})

test('a run that never touched the renamed file is left alone', async () => {
  const wp = newWorkspace()
  write(wp, 'agents/panel-optimist.md', '---\nname: Optimist\n---\nbody\n')
  const metaPath = write(wp, 'logs/2026-08-08-abc/meta.json', JSON.stringify({ versions: { 'agent/other': 1 } }))
  const before = read(metaPath)

  const { renameWorkspaceEntity } = await rename()
  const result = renameWorkspaceEntity('agent', 'panel-optimist', 'optimist')

  assert.deepStrictEqual(result.plan.runs, [])
  assert.strictEqual(read(metaPath), before)
})

test('a failure part-way leaves no half-rename behind', async () => {
  const wp = newWorkspace()
  const agentPath = write(wp, 'agents/panel-optimist.md', '---\nname: Optimist\n---\nbody\n')
  const chainPath = write(
    wp,
    'chains/decision.md',
    '---\nname: Decision\nnodes:\n  - id: a\n    kind: agent\n    agent: panel-optimist\nedges: []\n---\n',
  )
  const chainBefore = read(chainPath)

  // a directory where the renamed file must land makes fs.renameSync throw, after the
  // chain rewrite has already been written
  fs.mkdirSync(path.join(wp, 'agents', 'optimist.md'))

  const { renameWorkspaceEntity } = await rename()
  assert.throws(() => renameWorkspaceEntity('agent', 'panel-optimist', 'optimist'))

  assert.strictEqual(read(chainPath), chainBefore, 'the rewritten reference was rolled back')
  assert.ok(fs.existsSync(agentPath), 'the file is still at its old name')
})

test('a rename with no version history leaves no .versions directory behind', async () => {
  const wp = newWorkspace()
  write(wp, 'agents/panel-optimist.md', '---\nname: Optimist\n---\nbody\n')

  const { renameWorkspaceEntity } = await rename()
  renameWorkspaceEntity('agent', 'panel-optimist', 'optimist')

  assert.ok(!fs.existsSync(path.join(wp, '.versions', 'agent', 'optimist')))
})

test('renaming a skill rewrites its own name, the agent list, and both call-site markers', async () => {
  const wp = newWorkspace()
  const skillPath = write(wp, 'skills/concise.md', '---\nname: concise\ntype: behavioural\n---\nBe brief.\n')
  const agentPath = write(wp, 'agents/optimist.md', '---\nname: Optimist\nskills:\n  - concise\n  - base-protocol\n---\nbody\n')
  const chainPath = write(
    wp,
    'chains/decision.md',
    '---\nname: Decision\nnodes:\n  - id: a\n    kind: agent\n    agent: optimist\n    skills!:\n      - concise\n  - id: b\n    kind: decider\n    agent: optimist\n    skills+:\n      - concise\nedges: []\n---\n',
  )

  const { renameWorkspaceEntity } = await rename()
  renameWorkspaceEntity('skill', 'concise', 'brief')

  // the runtime matches a skill by its frontmatter `name`, so the name follows the slug
  assert.ok(!fs.existsSync(skillPath))
  const renamed = read(path.join(wp, 'skills', 'brief.md'))
  assert.ok(renamed.includes('name: brief'))
  assert.ok(renamed.includes('Be brief.'), 'the body is untouched')

  assert.ok(read(agentPath).includes('- brief'))
  assert.ok(read(agentPath).includes('- base-protocol'), 'the other entry is untouched')
  assert.strictEqual(read(chainPath).match(/- brief/g)?.length, 2)
  assert.ok(!read(chainPath).includes('concise'))

  const { loadWorkspace } = await import('../lib/fs/workspace')
  const ws = loadWorkspace()
  const { injectSkills } = await import('../lib/prompt')
  assert.ok(injectSkills(ws.agents[0], ws.skills, 'body').includes('Be brief.'))
})

test('renaming a context file rewrites the agent list and the context node', async () => {
  const wp = newWorkspace()
  write(wp, 'context/lore/tavern.md', '# Tavern\n')
  const agentPath = write(wp, 'agents/optimist.md', '---\nname: Optimist\ncontext:\n  - tavern\n---\nbody\n')
  const chainPath = write(
    wp,
    'chains/decision.md',
    '---\nname: Decision\nnodes:\n  - id: c\n    kind: context\n    file: tavern\nedges: []\n---\n',
  )

  const { renameWorkspaceEntity } = await rename()
  renameWorkspaceEntity('context', 'tavern', 'inn')

  assert.ok(fs.existsSync(path.join(wp, 'context', 'lore', 'inn.md')))
  assert.ok(read(agentPath).includes('- inn'))
  assert.ok(read(chainPath).includes('file: inn'))
})

test('renaming a chain rewrites a subchain node and a template that names it', async () => {
  const wp = newWorkspace()
  write(wp, 'chains/decision.md', '---\nname: Decision\nnodes: []\nedges: []\n---\n')
  const outerPath = write(
    wp,
    'chains/outer.md',
    '---\nname: Outer\nnodes:\n  - id: s\n    kind: subchain\n    subchain: decision\nedges: []\n---\n',
  )
  const templatePath = write(wp, 'templates/kickoff.md', '---\nname: Kickoff\nchain: decision\n---\nseed\n')

  const { renameWorkspaceEntity } = await rename()
  renameWorkspaceEntity('chain', 'decision', 'verdict')

  assert.ok(read(outerPath).includes('subchain: verdict'))
  assert.ok(read(templatePath).includes('chain: verdict'))
  assert.ok(read(templatePath).includes('seed'), 'the body is untouched')
})

test('a prose {slug} placeholder is reported, never rewritten', async () => {
  const wp = newWorkspace()
  write(wp, 'context/tavern.md', '# Tavern\n')
  const agentPath = write(wp, 'agents/optimist.md', '---\nname: Optimist\n---\nRead {tavern} and answer.\n')

  const { planRename, renameWorkspaceEntity } = await rename()
  const plan = planRename('context', 'tavern', 'inn')
  assert.deepStrictEqual(plan.manual.map(m => m.filePath), [agentPath])
  assert.deepStrictEqual(plan.rewrites, [])

  renameWorkspaceEntity('context', 'tavern', 'inn')
  assert.ok(read(agentPath).includes('{tavern}'), 'the prose placeholder is left for the user')
})

test('the plan names every file it will rewrite and the field it will touch', async () => {
  const wp = newWorkspace()
  write(wp, 'skills/concise.md', '---\nname: concise\n---\nBe brief.\n')
  const agentPath = write(wp, 'agents/optimist.md', '---\nname: Optimist\nskills:\n  - concise\n---\nbody\n')
  write(wp, 'agents/other.md', '---\nname: Other\nskills: []\n---\nbody\n')

  const { planRename } = await rename()
  const plan = planRename('skill', 'concise', 'brief')

  assert.deepStrictEqual(plan.rewrites.map(r => r.filePath), [agentPath])
  assert.deepStrictEqual(plan.rewrites[0].fields, ['skills'])
  assert.strictEqual(plan.from, 'concise')
  assert.strictEqual(plan.to, 'brief')
})

test('planning never writes to disk', async () => {
  const wp = newWorkspace()
  write(wp, 'skills/concise.md', '---\nname: concise\n---\nBe brief.\n')
  const agentPath = write(wp, 'agents/optimist.md', '---\nname: Optimist\nskills:\n  - concise\n---\nbody\n')
  const before = read(agentPath)

  const { planRename } = await rename()
  planRename('skill', 'concise', 'brief')

  assert.strictEqual(read(agentPath), before)
  assert.ok(fs.existsSync(path.join(wp, 'skills', 'concise.md')))
})

test('a name already taken anywhere under the type is rejected', async () => {
  const wp = newWorkspace()
  write(wp, 'agents/panel-optimist.md', '---\nname: Optimist\n---\nbody\n')
  write(wp, 'agents/deep/optimist.md', '---\nname: Other\n---\nbody\n')

  const { planRename } = await rename()
  // a duplicate leaf name anywhere under the type is a hard load failure (ADR-0012),
  // so the rename is refused before it can create one
  assert.throws(() => planRename('agent', 'panel-optimist', 'optimist'), /already/i)
})

test('renaming a slug with no file is refused', async () => {
  newWorkspace()
  const { planRename } = await rename()
  assert.throws(() => planRename('agent', 'ghost', 'spirit'), /not found/i)
})

test('a new name that sanitizes to nothing is refused', async () => {
  const wp = newWorkspace()
  write(wp, 'agents/optimist.md', '---\nname: Optimist\n---\nbody\n')

  const { planRename } = await rename()
  assert.throws(() => planRename('agent', 'optimist', '../..'), /invalid/i)
})

test('renaming to the same slug changes nothing', async () => {
  const wp = newWorkspace()
  const filePath = write(wp, 'agents/optimist.md', '---\nname: Optimist\n---\nbody\n')

  const { renameWorkspaceEntity } = await rename()
  const result = renameWorkspaceEntity('agent', 'optimist', 'optimist')

  assert.strictEqual(result.filePath, filePath)
  assert.deepStrictEqual(result.plan.rewrites, [])
})

test('every node field the registry marks as a reference is a rename site', async () => {
  const { allFields } = await import('../lib/nodeKinds')
  const { refSitesFor } = await rename()

  // the registry owns every field fact (ADR-0001), so a new referencing field must reach
  // the rename without a second list being edited
  for (const field of allFields.filter(f => f.ref)) {
    const site = refSitesFor(field.ref!).find(s => s.holder === 'chain' && s.field === field.key)
    assert.ok(site, `no rename site derives from the registry field \`${field.key}\``)
    assert.strictEqual(site!.list, field.codec === 'stringList')
  }
})

test('the workspace loads cleanly after a rename, with no dangling reference', async () => {
  const wp = newWorkspace()
  write(wp, 'agents/panel/panel-optimist.md', '---\nname: Optimist\nskills:\n  - concise\n---\nbody\n')
  write(wp, 'skills/concise.md', '---\nname: concise\n---\nBe brief.\n')
  write(
    wp,
    'chains/decision.md',
    '---\nname: Decision\nnodes:\n  - id: a\n    kind: agent\n    agent: panel-optimist\nedges: []\n---\n',
  )

  const { renameWorkspaceEntity } = await rename()
  renameWorkspaceEntity('agent', 'panel-optimist', 'optimist')

  const { loadWorkspace } = await import('../lib/fs/workspace')
  const ws = loadWorkspace()
  const node = ws.chains[0].nodes[0]
  assert.ok(node.kind === 'agent' && ws.agents.some(a => a.slug === node.agent))
})
