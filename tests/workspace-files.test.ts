import { test, expect, vi } from 'vitest'
import fs from 'fs'
import path from 'path'
import os from 'os'
import yaml from 'js-yaml'
import {
  address, readEntity, saveEntity, createEntity, createFolder, listFolders, moveEntity,
  planRename, renameEntity, deleteEntity,
} from '../lib/fs/workspaceFiles'
import { isWorkspaceError, type WorkspaceErrorKind } from '../lib/fs/errors'

function write(root: string, rel: string, body: string) {
  const p = path.join(root, rel)
  fs.mkdirSync(path.dirname(p), { recursive: true })
  fs.writeFileSync(p, body)
  return p
}

function newWorkspace() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'ws-files-'))
}

function refusal(fn: () => unknown): { kind: WorkspaceErrorKind; message: string } {
  try {
    fn()
  } catch (err) {
    if (isWorkspaceError(err)) return { kind: err.kind, message: err.message }
    throw err
  }
  throw new Error('expected a refusal')
}

const PREMORTEM = [
  '---',
  'name: Premortem',
  'model: test/model',
  'variants:',
  '  - id: rot',
  '  - id: burnout',
  '---',
  'Post-mortem body.',
  '',
].join('\n')

const PLAIN = '---\nname: Plain\nmodel: test/model\n---\nPlain body.\n'

function chain(name: string, agent: string) {
  return `---\nname: ${name}\nnodes:\n  - id: a\n    kind: agent\n    agent: ${agent}\nedges: []\n---\n`
}

test('address: a file of that name, a variant, or a place for a new file', () => {
  const wp = newWorkspace()
  const premortem = write(wp, 'agents/premortem.md', PREMORTEM)
  const plain = write(wp, 'agents/panel/plain.md', PLAIN)

  expect(address(wp, 'agent', 'plain')).toMatchObject({ kind: 'file', filePath: plain, storageSlug: 'plain' })
  expect(address(wp, 'agent', 'rot')).toMatchObject({
    kind: 'variant', filePath: premortem, storageSlug: 'premortem', variantOf: 'premortem',
  })
  expect(address(wp, 'agent', 'fresh', { folder: 'panel' })).toMatchObject({
    kind: 'new', filePath: path.join(wp, 'agents', 'panel', 'fresh.md'),
  })
  expect(address(wp, 'skill', 'rot').kind).toBe('new')
})

test('readEntity reads a variant as its declaring file and refuses a missing slug', () => {
  const wp = newWorkspace()
  write(wp, 'agents/premortem.md', PREMORTEM)
  write(wp, 'context/brand.md', 'Brand.\n')

  const rot = readEntity(wp, 'agent', 'rot') as { raw: string }
  expect(rot.raw).toBe(PREMORTEM)
  expect(readEntity(wp, 'context', 'brand')).toMatchObject({ slug: 'brand', name: 'brand', raw: 'Brand.\n' })
  expect(refusal(() => readEntity(wp, 'skill', 'ghost'))).toEqual({ kind: 'NOT_FOUND', message: 'Entity not found' })
})

test('saveEntity writes a variant into its declaring file and never a twin', () => {
  const wp = newWorkspace()
  const premortem = write(wp, 'agents/premortem.md', PREMORTEM)

  const saved = saveEntity(wp, {
    type: 'agent', slug: 'rot', data: { name: 'Premortem', model: 'test/model', variants: [{ id: 'rot' }] }, content: 'Edited.',
  })

  expect(saved).toEqual({ filePath: premortem, slug: 'premortem' })
  expect(fs.readFileSync(premortem, 'utf-8')).toContain('Edited.')
  expect(fs.existsSync(path.join(wp, 'agents', 'rot.md'))).toBe(false)
})

test('saveEntity saves into an existing sub-folder file instead of writing a root twin', () => {
  const wp = newWorkspace()
  const nested = write(wp, 'agents/panel/plain.md', PLAIN)

  saveEntity(wp, { type: 'agent', slug: 'plain', data: { name: 'Plain', model: 'test/model' }, content: 'edited' })

  expect(fs.readFileSync(nested, 'utf-8')).toContain('edited')
  expect(fs.existsSync(path.join(wp, 'agents', 'plain.md'))).toBe(false)
})

test('saveEntity warns on a missing required field but still saves', () => {
  const wp = newWorkspace()

  const saved = saveEntity(wp, { type: 'skill', slug: 'terse', data: {}, content: 'Be brief.' })

  expect(saved.warnings).toEqual(["Missing required field: 'name'"])
  expect(fs.existsSync(path.join(wp, 'skills', 'terse.md'))).toBe(true)
})

test('saveEntity refuses an agent that states an inheritance field, and writes nothing', () => {
  const wp = newWorkspace()

  const out = refusal(() => saveEntity(wp, { type: 'agent', slug: 'kid', data: { name: 'Kid', parent: 'x' }, content: '' }))

  expect(out.kind).toBe('INVALID_CONTENT')
  expect(out.message).toMatch(/may not state parent/)
  expect(fs.existsSync(path.join(wp, 'agents', 'kid.md'))).toBe(false)
})

test('saveEntity dumps and validates the frontmatter once', () => {
  const wp = newWorkspace()
  const dump = vi.spyOn(yaml, 'dump')

  saveEntity(wp, { type: 'skill', slug: 'terse', data: { name: 'Terse' }, content: 'Be brief.' })

  expect(dump).toHaveBeenCalledTimes(1)
  dump.mockRestore()
})

test('createEntity refuses a taken name, names a default slug, and honours a folder', () => {
  const wp = newWorkspace()
  write(wp, 'agents/panel/plain.md', PLAIN)

  expect(refusal(() => createEntity(wp, { type: 'agent', name: 'Plain' }))).toEqual({
    kind: 'ALREADY_EXISTS', message: 'an agent named `plain` already exists',
  })

  createFolder(wp, 'skill', 'craft')
  const made = createEntity(wp, { type: 'skill', name: 'Deep Dive', folder: 'craft' })
  expect(made.slug).toBe('deep-dive')
  expect(made.filePath).toBe(path.join(wp, 'skills', 'craft', 'deep-dive.md'))
})

test('createEntity never writes into the file that declares a same-named variant (ADR-0013)', () => {
  const wp = newWorkspace()
  const premortem = write(wp, 'agents/premortem.md', PREMORTEM)

  createEntity(wp, { type: 'agent', name: 'Rot' })

  expect(fs.readFileSync(premortem, 'utf-8')).toBe(PREMORTEM)
})

test('createEntity forks a chain from a template and refuses a missing one', () => {
  const wp = newWorkspace()
  write(wp, 'agents/plain.md', PLAIN)
  write(wp, 'chains/base.md', chain('Base', 'plain'))
  write(wp, 'templates/kickoff.md', '---\nname: Kickoff\nchain: base\n---\nseed text\n')

  const forked = createEntity(wp, { type: 'chain', name: 'My Run', fromTemplate: 'kickoff' }) as { filePath: string; seedPrompt: string }
  expect(fs.existsSync(forked.filePath)).toBe(true)
  expect(forked.seedPrompt).toBe('seed text')

  expect(refusal(() => createEntity(wp, { type: 'chain', name: 'X', fromTemplate: 'nope' }))).toEqual({
    kind: 'NOT_FOUND', message: 'Template not found',
  })
})

test('folders: create, list, refuse a duplicate or an unusable name', () => {
  const wp = newWorkspace()

  createFolder(wp, 'agent', 'panel')
  createFolder(wp, 'agent', 'deep', 'panel')

  expect(listFolders(wp, 'agent').sort()).toEqual(['panel', 'panel/deep'])
  expect(refusal(() => createFolder(wp, 'agent', 'panel')).kind).toBe('ALREADY_EXISTS')
  expect(refusal(() => createFolder(wp, 'agent', '..')).message).toBe('Invalid folder name')
})

test('moveEntity moves a file but refuses a variant, naming its declaring file', () => {
  const wp = newWorkspace()
  write(wp, 'agents/premortem.md', PREMORTEM)
  write(wp, 'agents/plain.md', PLAIN)

  expect(moveEntity(wp, 'agent', 'plain', 'panel').filePath).toBe(path.join(wp, 'agents', 'panel', 'plain.md'))
  expect(refusal(() => moveEntity(wp, 'agent', 'rot', 'panel'))).toEqual({
    kind: 'INVALID_NAME', message: '"rot" is a variant declared in premortem.md — edit that file instead.',
  })
  expect(refusal(() => moveEntity(wp, 'agent', 'ghost', 'panel')).kind).toBe('NOT_FOUND')
})

test('rename and delete address a variant the way save and read do', () => {
  const wp = newWorkspace()
  const premortem = write(wp, 'agents/premortem.md', PREMORTEM)

  expect(planRename(wp, 'agent', 'rot', 'decay').variantOf).toBe('premortem')
  renameEntity(wp, 'agent', 'rot', 'decay')
  expect(address(wp, 'agent', 'decay').filePath).toBe(premortem)
  expect(address(wp, 'agent', 'rot').kind).toBe('new')

  deleteEntity(wp, 'agent', 'decay')
  expect(fs.readFileSync(premortem, 'utf-8')).not.toContain('decay')
  expect(refusal(() => deleteEntity(wp, 'agent', 'ghost'))).toEqual({
    kind: 'NOT_FOUND', message: 'Entity not found: agent/ghost',
  })
})

test('delete is refused while a chain still names the file', () => {
  const wp = newWorkspace()
  write(wp, 'agents/plain.md', PLAIN)
  write(wp, 'chains/base.md', chain('Base', 'plain'))

  expect(refusal(() => deleteEntity(wp, 'agent', 'plain')).kind).toBe('IN_USE')
  expect(fs.existsSync(path.join(wp, 'agents', 'plain.md'))).toBe(true)
})
