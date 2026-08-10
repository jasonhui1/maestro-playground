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

function agent(name: string) {
  return `---\nname: ${name}\nmodel: test/model\n---\n${name} prompt\n`
}

function chain(name: string) {
  return `---\nname: ${name}\nnodes:\n  - id: a\n    kind: agent\n    agent: optimist\nedges: []\n---\n`
}

function newWorkspace() {
  const wp = fs.mkdtempSync(path.join(os.tmpdir(), 'ws-folders-'))
  process.env.WORKSPACE_PATH = wp
  return wp
}

async function load() {
  return import('../lib/fs/workspace')
}

test('every type loads from any depth, and a reference stays a bare slug', async () => {
  const wp = newWorkspace()
  write(wp, 'agents/panel/optimist.md', agent('Optimist'))
  write(wp, 'agents/flat.md', agent('Flat'))
  write(wp, 'skills/craft/deep/red-teaming.md', '---\nname: Red\n---\nbody\n')
  write(wp, 'chains/group/decision.md', chain('Decision'))
  write(wp, 'context/lore/tavern.md', '# Tavern\nbody\n')
  write(wp, 'tools/search/retrieve.md', '---\nexecutor: retrieve\n---\nSearch.\n')
  write(wp, 'templates/starters/kickoff.md', '---\nname: Kickoff\nchain: decision\n---\nseed\n')

  const { loadWorkspace } = await load()
  const ws = loadWorkspace()

  assert.deepStrictEqual(ws.agents.map(a => a.slug).sort(), ['flat', 'optimist'])
  assert.deepStrictEqual(ws.skills.map(s => s.slug), ['red-teaming'])
  assert.deepStrictEqual(ws.chains.map(c => c.slug), ['decision'])
  assert.deepStrictEqual(ws.context.map(c => c.slug), ['tavern'])
  assert.deepStrictEqual(ws.tools.map(t => t.slug), ['retrieve'])
  assert.deepStrictEqual(ws.templates.map(t => t.slug), ['kickoff'])

  // the chain names the agent by bare slug; the folder never enters the reference
  assert.strictEqual(ws.chains[0].nodes[0].kind === 'agent' && ws.chains[0].nodes[0].agent, 'optimist')

  // every loaded definition carries its path and its raw file content
  const optimist = ws.agents.find(a => a.slug === 'optimist')!
  assert.strictEqual(optimist.filePath, path.join(wp, 'agents', 'panel', 'optimist.md'))
  assert.strictEqual(optimist.rawContent, agent('Optimist'))
  assert.ok(ws.skills[0].rawContent && ws.chains[0].rawContent && ws.tools[0].rawContent)
  assert.ok(ws.templates[0].rawContent && ws.context[0].rawContent)
})

test('a file moved between folders resolves unchanged', async () => {
  const wp = newWorkspace()
  const before = write(wp, 'agents/optimist.md', agent('Optimist'))
  write(wp, 'chains/decision.md', chain('Decision'))

  const { loadWorkspace } = await load()
  const flat = loadWorkspace()
  assert.strictEqual(flat.agents[0].slug, 'optimist')

  // move it into a folder — nothing else changes
  fs.mkdirSync(path.join(wp, 'agents', 'panel'))
  fs.renameSync(before, path.join(wp, 'agents', 'panel', 'optimist.md'))

  const moved = loadWorkspace()
  assert.strictEqual(moved.agents[0].slug, 'optimist')
  assert.strictEqual(moved.chains[0].nodes[0].kind === 'agent' && moved.chains[0].nodes[0].agent, 'optimist')
})

test('two files sharing a slug fail the load, naming both paths', async () => {
  const wp = newWorkspace()
  const a = write(wp, 'agents/optimist.md', agent('One'))
  const b = write(wp, 'agents/panel/optimist.md', agent('Two'))

  const { loadWorkspace } = await load()
  assert.throws(
    () => loadWorkspace(),
    (err: Error) => err.message.includes(a) && err.message.includes(b)
  )
})

test('a flat workspace with no sub-folders still loads', async () => {
  const wp = newWorkspace()
  write(wp, 'agents/one.md', agent('One'))
  write(wp, 'agents/two.md', agent('Two'))

  const { loadWorkspace } = await load()
  assert.deepStrictEqual(loadWorkspace().agents.map(a => a.slug).sort(), ['one', 'two'])
})

test('saving a nested file writes to that file; a new file defaults to the type root', async () => {
  const wp = newWorkspace()
  const nested = write(wp, 'agents/panel/optimist.md', agent('Optimist'))

  const { resolveEntityPath } = await load()
  assert.strictEqual(resolveEntityPath('agent', 'optimist'), nested)

  // a slug no file holds is a new file, and lands at the type directory root
  assert.strictEqual(resolveEntityPath('agent', 'newcomer'), path.join(wp, 'agents', 'newcomer.md'))

  const { saveWorkspaceEntity } = await import('../lib/fs/save')
  saveWorkspaceEntity({ type: 'agent', slug: 'optimist', data: { name: 'Optimist' }, content: 'edited' })

  assert.ok(fs.readFileSync(nested, 'utf-8').includes('edited'))
  assert.ok(!fs.existsSync(path.join(wp, 'agents', 'optimist.md')), 'no root twin was created')
})

test('resolveEntityPath honours an explicit folder for a genuinely new file', async () => {
  const wp = newWorkspace()
  fs.mkdirSync(path.join(wp, 'agents', 'panel'), { recursive: true })

  const { resolveEntityPath } = await load()
  assert.strictEqual(
    resolveEntityPath('agent', 'newcomer', 'panel'),
    path.join(wp, 'agents', 'panel', 'newcomer.md'),
  )
})

test('resolveEntityPath still resolves to the existing file when a folder is also given', async () => {
  const wp = newWorkspace()
  const nested = write(wp, 'agents/panel/optimist.md', agent('Optimist'))

  const { resolveEntityPath } = await load()
  // the slug already exists elsewhere — the existing file wins over the requested folder,
  // preserving "duplicate leaf name anywhere under the type" as a hard load failure (ADR-0012)
  assert.strictEqual(resolveEntityPath('agent', 'optimist', 'other'), nested)
})

test('a folder value cannot escape the type directory', async () => {
  const wp = newWorkspace()

  const { resolveEntityPath } = await load()
  const absoluteSubDir = path.join(wp, 'agents')
  assert.strictEqual(
    resolveEntityPath('agent', 'newcomer', '../../etc'),
    path.join(absoluteSubDir, 'etc', 'newcomer.md'),
  )
  assert.ok(resolveEntityPath('agent', 'newcomer', '../../etc').startsWith(absoluteSubDir))
})

test('sanitizeFolder strips a traversal-only name down to empty, not a lookalike sibling', async () => {
  const { sanitizeFolder } = await load()
  // '..' carries no safe character, so it sanitizes to '' rather than colliding with
  // whatever the parent folder already is — the POST route rejects an empty result
  // before it ever reaches resolveFolderPath.
  assert.strictEqual(sanitizeFolder('..'), '')
  assert.strictEqual(sanitizeFolder('...'), '...')
})

test('resolveFolderPath resolves under the type directory and cannot escape it', async () => {
  const wp = newWorkspace()

  const { resolveFolderPath } = await load()
  assert.strictEqual(resolveFolderPath('agent', 'panel'), path.join(wp, 'agents', 'panel'))
  assert.strictEqual(resolveFolderPath('agent', 'panel/deep'), path.join(wp, 'agents', 'panel', 'deep'))

  const absoluteSubDir = path.join(wp, 'agents')
  assert.ok(resolveFolderPath('agent', '../../etc').startsWith(absoluteSubDir))
})

test('moveWorkspaceEntity relocates the file; the slug still resolves and chain refs are untouched', async () => {
  const wp = newWorkspace()
  write(wp, 'agents/optimist.md', agent('Optimist'))
  write(wp, 'chains/decision.md', chain('Decision'))

  const { moveWorkspaceEntity } = await import('../lib/fs/save')
  const result = moveWorkspaceEntity('agent', 'optimist', 'panel')
  assert.strictEqual(result.filePath, path.join(wp, 'agents', 'panel', 'optimist.md'))
  assert.strictEqual(result.slug, 'optimist')
  assert.ok(!fs.existsSync(path.join(wp, 'agents', 'optimist.md')))
  assert.ok(fs.existsSync(path.join(wp, 'agents', 'panel', 'optimist.md')))

  const { loadWorkspace } = await load()
  const ws = loadWorkspace()
  assert.strictEqual(ws.agents[0].slug, 'optimist')
  assert.strictEqual(ws.chains[0].nodes[0].kind === 'agent' && ws.chains[0].nodes[0].agent, 'optimist')
})

test('moveWorkspaceEntity to the empty folder moves a file back to the type root', async () => {
  const wp = newWorkspace()
  write(wp, 'agents/panel/optimist.md', agent('Optimist'))

  const { moveWorkspaceEntity } = await import('../lib/fs/save')
  const result = moveWorkspaceEntity('agent', 'optimist', '')
  assert.strictEqual(result.filePath, path.join(wp, 'agents', 'optimist.md'))
  assert.ok(fs.existsSync(path.join(wp, 'agents', 'optimist.md')))
})

test('moveWorkspaceEntity rejects a target outside the type directory', async () => {
  const wp = newWorkspace()
  write(wp, 'agents/optimist.md', agent('Optimist'))

  const { moveWorkspaceEntity } = await import('../lib/fs/save')
  // sanitizeFolder strips every traversal segment, so this lands under the type dir
  // rather than escaping it — proving the guard holds even for an adversarial folder value
  const result = moveWorkspaceEntity('agent', 'optimist', '../../etc')
  const absoluteSubDir = path.join(wp, 'agents')
  assert.ok(result.filePath.startsWith(absoluteSubDir))
})

test('moveWorkspaceEntity throws for a slug with no file', async () => {
  newWorkspace()
  const { moveWorkspaceEntity } = await import('../lib/fs/save')
  assert.throws(
    () => moveWorkspaceEntity('agent', 'ghost', 'panel'),
    /Entity not found/,
  )
})

test('createWorkspaceFolder makes an empty directory that a reload still sees', async () => {
  const wp = newWorkspace()

  const { createWorkspaceFolder } = await import('../lib/fs/save')
  const { folderPath } = createWorkspaceFolder('agent', 'panel/deep')

  assert.strictEqual(folderPath, path.join(wp, 'agents', 'panel', 'deep'))
  assert.ok(fs.statSync(folderPath).isDirectory())
  assert.deepStrictEqual(fs.readdirSync(folderPath), [])
})

test('renameWorkspaceFolder renames the leaf segment, keeping its parent and its files', async () => {
  const wp = newWorkspace()
  write(wp, 'agents/panel/optimist.md', agent('Optimist'))

  const { renameWorkspaceFolder } = await import('../lib/fs/save')
  const result = renameWorkspaceFolder('agent', 'panel', 'roster')

  assert.strictEqual(result.folder, 'roster')
  assert.strictEqual(result.folderPath, path.join(wp, 'agents', 'roster'))
  assert.ok(fs.existsSync(path.join(wp, 'agents', 'roster', 'optimist.md')))
  assert.ok(!fs.existsSync(path.join(wp, 'agents', 'panel')))

  // a folder is never a reference (ADR-0012), so the file's slug still resolves unchanged
  const { loadWorkspace } = await load()
  assert.strictEqual(loadWorkspace().agents[0].slug, 'optimist')
})

test('renameWorkspaceFolder renames a nested folder without moving it out from under its parent', async () => {
  const wp = newWorkspace()
  write(wp, 'agents/panel/deep/optimist.md', agent('Optimist'))

  const { renameWorkspaceFolder } = await import('../lib/fs/save')
  const result = renameWorkspaceFolder('agent', 'panel/deep', 'deeper')

  assert.strictEqual(result.folder, 'panel/deeper')
  assert.ok(fs.existsSync(path.join(wp, 'agents', 'panel', 'deeper', 'optimist.md')))
})

test('renameWorkspaceFolder rejects a name colliding with an existing sibling', async () => {
  const wp = newWorkspace()
  fs.mkdirSync(path.join(wp, 'agents', 'panel'), { recursive: true })
  fs.mkdirSync(path.join(wp, 'agents', 'roster'), { recursive: true })

  const { renameWorkspaceFolder } = await import('../lib/fs/save')
  assert.throws(() => renameWorkspaceFolder('agent', 'panel', 'roster'), /already exists/)
})

test('renameWorkspaceFolder to the same name changes nothing', async () => {
  const wp = newWorkspace()
  fs.mkdirSync(path.join(wp, 'agents', 'panel'), { recursive: true })

  const { renameWorkspaceFolder } = await import('../lib/fs/save')
  const result = renameWorkspaceFolder('agent', 'panel', 'panel')
  assert.strictEqual(result.folder, 'panel')
  assert.ok(fs.existsSync(path.join(wp, 'agents', 'panel')))
})

test('renameWorkspaceFolder throws for a folder that does not exist', async () => {
  newWorkspace()
  const { renameWorkspaceFolder } = await import('../lib/fs/save')
  assert.throws(() => renameWorkspaceFolder('agent', 'ghost', 'spirit'), /not found/i)
})

test('renameWorkspaceFolder rejects a new name that sanitizes to nothing', async () => {
  const wp = newWorkspace()
  fs.mkdirSync(path.join(wp, 'agents', 'panel'), { recursive: true })

  const { renameWorkspaceFolder } = await import('../lib/fs/save')
  assert.throws(() => renameWorkspaceFolder('agent', 'panel', '../..'), /invalid/i)
})

test('deleteWorkspaceFolder removes an empty folder from disk', async () => {
  const wp = newWorkspace()
  fs.mkdirSync(path.join(wp, 'agents', 'panel'), { recursive: true })

  const { deleteWorkspaceFolder } = await import('../lib/fs/save')
  deleteWorkspaceFolder('agent', 'panel')

  assert.ok(!fs.existsSync(path.join(wp, 'agents', 'panel')))
})

test('deleteWorkspaceFolder refuses a folder holding files, naming the count', async () => {
  const wp = newWorkspace()
  write(wp, 'agents/panel/optimist.md', agent('Optimist'))
  write(wp, 'agents/panel/deep/second.md', agent('Second'))

  const { deleteWorkspaceFolder } = await import('../lib/fs/save')
  assert.throws(() => deleteWorkspaceFolder('agent', 'panel'), /2 files inside/)
  assert.ok(fs.existsSync(path.join(wp, 'agents', 'panel', 'optimist.md')))
})

test('deleteWorkspaceFolder refuses a folder holding only an empty subfolder', async () => {
  const wp = newWorkspace()
  fs.mkdirSync(path.join(wp, 'agents', 'panel', 'deep'), { recursive: true })

  const { deleteWorkspaceFolder } = await import('../lib/fs/save')
  assert.throws(() => deleteWorkspaceFolder('agent', 'panel'))
  assert.ok(fs.existsSync(path.join(wp, 'agents', 'panel', 'deep')))
})

test('deleteWorkspaceFolder throws for a folder that does not exist', async () => {
  newWorkspace()
  const { deleteWorkspaceFolder } = await import('../lib/fs/save')
  assert.throws(() => deleteWorkspaceFolder('agent', 'ghost'), /not found/i)
})

test('a nested context file is readable at run time, by bare slug', async () => {
  const wp = newWorkspace()
  write(wp, 'context/lore/tavern.md', '---\nname: Tavern\n---\nThe Gilded Flagon.\n')

  // the {slug} placeholder path a prompt uses
  const { resolveRefs } = await import('../lib/resolver')
  assert.strictEqual(resolveRefs('{tavern}', [], wp, ''), 'The Gilded Flagon.')
})
