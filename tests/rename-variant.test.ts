import { test, afterEach, vi } from 'vitest'
import assert from 'node:assert'
import fs from 'fs'
import path from 'path'
import os from 'os'

const ORIGINAL_WORKSPACE = process.env.WORKSPACE_PATH

afterEach(() => {
  vi.restoreAllMocks()
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
  const wp = fs.mkdtempSync(path.join(os.tmpdir(), 'ws-rename-variant-'))
  process.env.WORKSPACE_PATH = wp
  return wp
}

const read = (p: string) => fs.readFileSync(p, 'utf-8')

async function rename() {
  return import('../lib/fs/rename')
}

const PREMORTEM = [
  '---',
  'name: Premortem',
  'variants:',
  '  - id: rot',
  '    name: "Root cause: rot"',
  '    skills+:',
  '      - cause-technical',
  '  - id: burnout',
  '    skills+:',
  '      - cause-motivation',
  '---',
  'Write the post-mortem.',
  '',
].join('\n')

const CHAIN = [
  '---',
  'name: Decision',
  'nodes:',
  '  - id: a',
  '    kind: agent',
  '    agent: rot',
  '  - id: b',
  '    kind: agent',
  '    agent: burnout',
  'edges: []',
  '---',
  '',
].join('\n')

test('renaming a variant rewrites its id in the declaring file and every chain naming it', async () => {
  const wp = newWorkspace()
  const agentPath = write(wp, 'agents/premortem.md', PREMORTEM)
  const chainPath = write(wp, 'chains/decision.md', CHAIN)

  const { renameWorkspaceEntity } = await rename()
  const result = renameWorkspaceEntity('agent', 'rot', 'decay')

  assert.strictEqual(result.filePath, agentPath, 'a variant has no file of its own to move')
  assert.ok(fs.existsSync(agentPath))
  assert.ok(!fs.existsSync(path.join(wp, 'agents', 'decay.md')), 'no file was created for the variant')

  const agent = read(agentPath)
  assert.ok(agent.includes('id: decay'))
  assert.ok(!agent.includes('id: rot'))
  assert.ok(agent.includes('id: burnout'), 'the sibling variant is untouched')
  assert.ok(agent.includes('Write the post-mortem.'), 'the shared body is untouched')

  assert.ok(read(chainPath).includes('agent: decay'))
  assert.ok(read(chainPath).includes('agent: burnout'), 'the sibling call site is untouched')

  const { loadWorkspace } = await import('../lib/fs/workspace')
  const ws = loadWorkspace()
  assert.deepStrictEqual(ws.agents.map(a => a.slug).sort(), ['burnout', 'decay'])
  const node = ws.chains[0].nodes[0]
  assert.ok(node.kind === 'agent' && ws.agents.some(a => a.slug === node.agent))
})

test('the plan for a variant names the declaring file among the files it will touch', async () => {
  const wp = newWorkspace()
  const agentPath = write(wp, 'agents/premortem.md', PREMORTEM)
  const chainPath = write(wp, 'chains/decision.md', CHAIN)

  const { planRename } = await rename()
  const plan = planRename('agent', 'rot', 'decay')

  assert.strictEqual(plan.variantOf, 'premortem')
  assert.deepStrictEqual(plan.rewrites.map(r => r.filePath), [agentPath, chainPath])
  assert.deepStrictEqual(plan.rewrites[0].fields, ['variants'])
  assert.deepStrictEqual(plan.rewrites[1].fields, ['agent'])
  assert.strictEqual(read(agentPath), PREMORTEM, 'planning never writes to disk')
})

test('renaming a file that declares variants moves the file and its history, and rewrites no chain', async () => {
  const wp = newWorkspace()
  write(wp, 'agents/panel/premortem.md', PREMORTEM)
  const chainPath = write(wp, 'chains/decision.md', CHAIN)
  const chainBefore = read(chainPath)

  const { snapshotVersion, getVersionContent } = await import('../lib/fs/versions')
  snapshotVersion('agent', 'premortem', 'v1 body')

  const { renameWorkspaceEntity } = await rename()
  const result = renameWorkspaceEntity('agent', 'premortem', 'post-mortem')

  assert.strictEqual(result.filePath, path.join(wp, 'agents', 'panel', 'post-mortem.md'))
  assert.ok(!fs.existsSync(path.join(wp, 'agents', 'panel', 'premortem.md')))
  assert.strictEqual(getVersionContent('agent', 'post-mortem', 1), 'v1 body')

  // The file's own name addresses no chain (ADR-0013), so the call sites still name the variants.
  assert.strictEqual(read(chainPath), chainBefore)
  assert.deepStrictEqual(result.plan.rewrites, [])
})

test('a variant rename leaves past run pins untouched, and the runs still resolve', async () => {
  const wp = newWorkspace()
  write(wp, 'agents/premortem.md', PREMORTEM)
  const metaPath = write(
    wp,
    'logs/2026-08-08-abc/meta.json',
    JSON.stringify({ runId: '2026-08-08-abc', versions: { 'agent/premortem': 1 } }),
  )
  const metaBefore = read(metaPath)

  const { snapshotVersion, getVersionContent } = await import('../lib/fs/versions')
  snapshotVersion('agent', 'premortem', 'the pinned bytes')

  const { renameWorkspaceEntity } = await rename()
  const result = renameWorkspaceEntity('agent', 'rot', 'decay')

  // A run keys on the declaring file's slug (ADR-0011), which the rename never touched.
  assert.deepStrictEqual(result.plan.runs, [])
  assert.strictEqual(read(metaPath), metaBefore)
  assert.strictEqual(getVersionContent('agent', 'premortem', 1), 'the pinned bytes')
})

test('a rename is refused when the new name is taken by a file or by a variant, naming both sources', async () => {
  const wp = newWorkspace()
  write(wp, 'agents/premortem.md', PREMORTEM)
  write(wp, 'agents/deep/optimist.md', '---\nname: Optimist\n---\nbody\n')

  const { planRename } = await rename()

  // variant → an existing agent file
  assert.throws(() => planRename('agent', 'rot', 'optimist'), (err: Error) =>
    /already/i.test(err.message) && err.message.includes('optimist.md'))
  // variant → a sibling variant
  assert.throws(() => planRename('agent', 'rot', 'burnout'), (err: Error) =>
    /already/i.test(err.message) && err.message.includes('premortem.md'))
  // file → a variant declared in another file
  assert.throws(() => planRename('agent', 'optimist', 'rot'), (err: Error) =>
    /already/i.test(err.message) && err.message.includes('premortem.md'))
})

test('a failure part-way leaves no half-renamed variant behind', async () => {
  const wp = newWorkspace()
  const agentPath = write(wp, 'agents/premortem.md', PREMORTEM)
  const chainPath = write(wp, 'chains/decision.md', CHAIN)

  // The declaring file is written after the chain, so its failure has a rewrite to undo.
  const realWrite = fs.writeFileSync
  let failed = false
  vi.spyOn(fs, 'writeFileSync').mockImplementation(((p: fs.PathOrFileDescriptor, ...rest: unknown[]) => {
    if (!failed && p === agentPath) { failed = true; throw new Error('disk full') }
    return (realWrite as (...a: unknown[]) => void)(p, ...rest)
  }) as typeof fs.writeFileSync)

  const { renameWorkspaceEntity } = await rename()
  assert.throws(() => renameWorkspaceEntity('agent', 'rot', 'decay'), /disk full/)

  assert.strictEqual(read(chainPath), CHAIN, 'the rewritten call site was rolled back')
  assert.strictEqual(read(agentPath), PREMORTEM, 'the declaring file still names the old variant')
})

test('a malformed variants block blocks no rename — not its own file, not an unrelated one', async () => {
  const wp = newWorkspace()
  write(wp, 'agents/premortem.md', PREMORTEM)
  write(wp, 'agents/broken.md', '---\nname: Broken\nvariants: 3\n---\nbody\n')

  const { planRename, renameWorkspaceEntity } = await rename()

  // The load-time check already reports the malformed file (ADR-0012); it must not also
  // stop the user editing it, or anything else, back into shape.
  assert.strictEqual(planRename('agent', 'rot', 'decay').variantOf, 'premortem')
  renameWorkspaceEntity('agent', 'broken', 'mended')
  assert.ok(fs.existsSync(path.join(wp, 'agents', 'mended.md')))
})

test('a variant named in prompt prose is reported, never rewritten', async () => {
  const wp = newWorkspace()
  write(wp, 'agents/premortem.md', PREMORTEM)
  const readerPath = write(wp, 'agents/reader.md', '---\nname: Reader\n---\nSee {rot.output}.\n')

  const { planRename, renameWorkspaceEntity } = await rename()
  assert.deepStrictEqual(planRename('agent', 'rot', 'decay').manual.map(m => m.filePath), [readerPath])

  renameWorkspaceEntity('agent', 'rot', 'decay')
  assert.ok(read(readerPath).includes('{rot.output}'), 'the prose placeholder is left for the user')
})
