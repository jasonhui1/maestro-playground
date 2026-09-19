import { test, vi } from 'vitest'
import assert from 'node:assert'
import fs from 'fs'
import path from 'path'
import os from 'os'
import { NextRequest } from 'next/server'
import { validateEntityFrontmatter } from '../lib/fs/validate'
import { PUT as entityPUT } from '../app/api/workspace/[type]/[slug]/route'

// Routes take their root from the one request entry; a test hands in its own (#116).
const entry = vi.hoisted(() => ({ root: '' }))
vi.mock('@/lib/requestWorkspace', async () => {
  const { diskWorkspace } = await import('../lib/runFolders')
  return { requestWorkspace: () => diskWorkspace(entry.root) }
})

function write(root: string, rel: string, body: string) {
  const p = path.join(root, rel)
  fs.mkdirSync(path.dirname(p), { recursive: true })
  fs.writeFileSync(p, body)
  return p
}

function newWorkspace() {
  const wp = fs.mkdtempSync(path.join(os.tmpdir(), 'ws-validate-entity-'))
  entry.root = wp
  return wp
}

// Frontmatter validation per entity type (#122).
test('validateEntityFrontmatter validates agent entities and defaults inheritance', () => {
  // Valid with explicit model
  const explicit = validateEntityFrontmatter('agent', { name: 'triage', model: 'gpt-4' })
  assert.strictEqual(explicit.valid, true)
  assert.deepStrictEqual(explicit.errors, [])
  assert.strictEqual(explicit.error, undefined)

  // Valid when model inherited from defaults
  const inherited = validateEntityFrontmatter('agent', { name: 'triage' }, { model: 'defaults/model' })
  assert.strictEqual(inherited.valid, true)
  assert.deepStrictEqual(inherited.errors, [])

  // Invalid without name
  const noName = validateEntityFrontmatter('agent', { model: 'gpt-4' })
  assert.strictEqual(noName.valid, false)
  assert.ok(noName.errors.some(e => e.includes('name')))
  assert.strictEqual(noName.error, noName.errors[0])

  // Invalid lacking both file model and default model
  const noModel = validateEntityFrontmatter('agent', { name: 'triage' }, {})
  assert.strictEqual(noModel.valid, false)
  assert.ok(noModel.errors.some(e => e.includes('model')))

  // Invalid with forbidden agent fields
  const parent = validateEntityFrontmatter('agent', { name: 'triage', model: 'gpt-4', parent: 'base' })
  assert.strictEqual(parent.valid, false)
  assert.ok(parent.errors.some(e => e.includes('parent') && e.includes('ADR-0010')))

  const extend = validateEntityFrontmatter('agent', { name: 'triage', model: 'gpt-4', extends: 'base' })
  assert.strictEqual(extend.valid, false)
  assert.ok(extend.errors.some(e => e.includes('extends') && e.includes('ADR-0010')))
})

test('validateEntityFrontmatter validates skill entities', () => {
  const valid = validateEntityFrontmatter('skill', { name: 'concise' })
  assert.strictEqual(valid.valid, true)
  assert.deepStrictEqual(valid.errors, [])

  const missing = validateEntityFrontmatter('skill', {})
  assert.strictEqual(missing.valid, false)
  assert.ok(missing.errors.some(e => e.includes('name')))
})

test('validateEntityFrontmatter validates chain entities', () => {
  const valid = validateEntityFrontmatter('chain', { name: 'decision', nodes: [], edges: [] })
  assert.strictEqual(valid.valid, true)
  assert.deepStrictEqual(valid.errors, [])

  const missingName = validateEntityFrontmatter('chain', { nodes: [], edges: [] })
  assert.strictEqual(missingName.valid, false)
  assert.ok(missingName.errors.some(e => e.includes('name')))

  const invalidNodes = validateEntityFrontmatter('chain', { name: 'decision', nodes: 'bad', edges: [] })
  assert.strictEqual(invalidNodes.valid, false)
  assert.ok(invalidNodes.errors.some(e => e.includes('nodes')))

  const invalidEdges = validateEntityFrontmatter('chain', { name: 'decision', nodes: [], edges: null })
  assert.strictEqual(invalidEdges.valid, false)
  assert.ok(invalidEdges.errors.some(e => e.includes('edges')))
})

test('validateEntityFrontmatter validates template entities', () => {
  const valid = validateEntityFrontmatter('template', { name: 'base', chain: 'base-chain' })
  assert.strictEqual(valid.valid, true)
  assert.deepStrictEqual(valid.errors, [])

  const missingChain = validateEntityFrontmatter('template', { name: 'base' })
  assert.strictEqual(missingChain.valid, false)
  assert.ok(missingChain.errors.some(e => e.includes('chain')))

  const nonStringChain = validateEntityFrontmatter('template', { name: 'base', chain: 123 })
  assert.strictEqual(nonStringChain.valid, false)
  assert.ok(nonStringChain.errors.some(e => e.includes('chain')))
})

test('validateEntityFrontmatter validates tool entities', () => {
  const valid = validateEntityFrontmatter('tool', { name: 'search', executor: 'tools/search.ts' })
  assert.strictEqual(valid.valid, true)
  assert.deepStrictEqual(valid.errors, [])

  const missingExec = validateEntityFrontmatter('tool', { name: 'search' })
  assert.strictEqual(missingExec.valid, false)
  assert.ok(missingExec.errors.some(e => e.includes('executor')))

  const nonStringExec = validateEntityFrontmatter('tool', { name: 'search', executor: 42 })
  assert.strictEqual(nonStringExec.valid, false)
  assert.ok(nonStringExec.errors.some(e => e.includes('executor')))
})

test('validateEntityFrontmatter allows context and unknown types without frontmatter rules', () => {
  assert.strictEqual(validateEntityFrontmatter('context', {}).valid, true)
  assert.strictEqual(validateEntityFrontmatter('context', { arbitrary: 'data' }).valid, true)
  assert.strictEqual(validateEntityFrontmatter('unknown', {}).valid, true)
})

// PUT route warns on missing required fields and saves (200), rejects forbidden fields (400) (#122).
test('PUT route warns on missing required fields but saves successfully', async () => {
  const wp = newWorkspace()

  // Agent lacking both file model and default model saves with 200 and warnings
  const noModelReq = new NextRequest('http://localhost/api/workspace/agent/triage', {
    method: 'PUT',
    body: JSON.stringify({
      data: { name: 'Triage' },
      content: 'System prompt',
    }),
  })
  const noModelRes = await entityPUT(noModelReq, { params: Promise.resolve({ type: 'agent', slug: 'triage' }) })
  assert.strictEqual(noModelRes.status, 200)
  const noModelJson = await noModelRes.json()
  assert.strictEqual(noModelJson.success, true)
  assert.ok(Array.isArray(noModelJson.warnings))
  assert.ok(noModelJson.warnings.some((e: string) => e.includes('model')))
  assert.ok(fs.existsSync(path.join(wp, 'agents', 'triage.md')))

  // Tool lacking executor saves with 200 and warnings
  const badToolReq = new NextRequest('http://localhost/api/workspace/tool/search', {
    method: 'PUT',
    body: JSON.stringify({
      data: { name: 'Search' },
      content: '',
    }),
  })
  const badToolRes = await entityPUT(badToolReq, { params: Promise.resolve({ type: 'tool', slug: 'search' }) })
  assert.strictEqual(badToolRes.status, 200)
  const badToolJson = await badToolRes.json()
  assert.strictEqual(badToolJson.success, true)
  assert.ok(Array.isArray(badToolJson.warnings))
  assert.ok(badToolJson.warnings.some((e: string) => e.includes('executor')))
})

test('PUT route rejects forbidden agent fields with 400', async () => {
  const wp = newWorkspace()

  const forbiddenReq = new NextRequest('http://localhost/api/workspace/agent/triage', {
    method: 'PUT',
    body: JSON.stringify({
      data: { name: 'Triage', model: 'gpt-4', parent: 'base' },
      content: 'System prompt',
    }),
  })
  const forbiddenRes = await entityPUT(forbiddenReq, { params: Promise.resolve({ type: 'agent', slug: 'triage' }) })
  assert.strictEqual(forbiddenRes.status, 400)
  const forbiddenJson = await forbiddenRes.json()
  assert.ok(forbiddenJson.error?.includes('parent'))
  assert.ok(forbiddenJson.error?.includes('ADR-0010'))
})

test('PUT route saves valid entity with no warnings', async () => {
  const wp = newWorkspace()

  const validReq = new NextRequest('http://localhost/api/workspace/agent/triage', {
    method: 'PUT',
    body: JSON.stringify({
      data: { name: 'Triage', model: 'gpt-4' },
      content: 'System prompt',
    }),
  })
  const validRes = await entityPUT(validReq, { params: Promise.resolve({ type: 'agent', slug: 'triage' }) })
  assert.strictEqual(validRes.status, 200)
  const validJson = await validRes.json()
  assert.strictEqual(validJson.success, true)
  assert.strictEqual(validJson.warnings, undefined)
})
