import { test, afterEach, vi } from 'vitest'
import assert from 'node:assert'
import fs from 'fs'
import path from 'path'
import os from 'os'
import { NextRequest } from 'next/server'
import { loadWorkspace } from '../lib/fs/workspace'
import { validateChain } from '../lib/chainGraph'
import { GET as workspaceGET } from '../app/api/workspace/route'
import { PUT as entityPUT } from '../app/api/workspace/[type]/[slug]/route'
import { POST as workspacePOST } from '../app/api/workspace/route'
import { pinnedWorkspace } from '../lib/pinnedWorkspace'
import { diskWorkspace } from '../lib/runFolders'
import { requestEntry } from './helpers/requestWorkspace'

vi.mock('@/lib/requestWorkspace', () => import('./helpers/requestWorkspace'))

afterEach(() => {
  vi.restoreAllMocks()
})

function write(root: string, rel: string, body: string) {
  const p = path.join(root, rel)
  fs.mkdirSync(path.dirname(p), { recursive: true })
  fs.writeFileSync(p, body)
  return p
}

function newWorkspace() {
  const wp = fs.mkdtempSync(path.join(os.tmpdir(), 'ws-name-clash-'))
  requestEntry.root = wp
  return wp
}

// #151: two agent files sharing a name must not take the whole workspace down.
test('a duplicate agent file name is excluded and warned about, not thrown', () => {
  const wp = newWorkspace()
  write(wp, 'agents/creative/fixer.md', '---\nname: Fixer A\n---\nbody\n')
  write(wp, 'agents/scratch/fixer.md', '---\nname: Fixer B\n---\nbody\n')
  write(wp, 'agents/critic.md', '---\nname: Critic\n---\nbody\n')

  const ws = loadWorkspace(wp)
  assert.deepStrictEqual(ws.agents.map(a => a.slug), ['critic'])

  const warning = ws.warnings.find(w => w.entityType === 'agent' && w.name === 'fixer')
  assert.ok(warning, 'expected a warning naming the clashing agent')
  assert.strictEqual(warning!.paths.length, 2)
  assert.strictEqual(warning!.message, 'Two agents are named "fixer": creative/fixer.md, scratch/fixer.md')
})

test('a clash of three or more files counts every path in its message', () => {
  const wp = newWorkspace()
  write(wp, 'agents/a/fixer.md', '---\nname: A\n---\nbody\n')
  write(wp, 'agents/b/fixer.md', '---\nname: B\n---\nbody\n')
  write(wp, 'agents/c/fixer.md', '---\nname: C\n---\nbody\n')

  const warning = loadWorkspace(wp).warnings.find(w => w.name === 'fixer')
  assert.strictEqual(warning!.message, '3 agents are named "fixer": a/fixer.md, b/fixer.md, c/fixer.md')
})

// #151: a variant id clashing with another file's own name is excluded on both sides.
test('a variant id clashing with a file name excludes both and warns', () => {
  const wp = newWorkspace()
  write(wp, 'agents/rewriter.md', '---\nname: Base\nvariants:\n  - id: critic\n---\nbody\n')
  write(wp, 'agents/critic.md', '---\nname: Critic\n---\nbody\n')

  const ws = loadWorkspace(wp)
  assert.deepStrictEqual(ws.agents.map(a => a.slug), [])
  const warning = ws.warnings.find(w => w.entityType === 'agent' && w.name === 'critic')
  assert.ok(warning, 'expected a warning naming the clashing "critic" name')
  assert.strictEqual(warning!.paths.length, 2)
})

// #151: a chain file name clash is excluded and warned the same way agents are.
test('a duplicate chain file name is excluded and warned about', () => {
  const wp = newWorkspace()
  write(wp, 'chains/a/pipeline.md', '---\nname: Pipeline A\nnodes: []\nedges: []\n---\n')
  write(wp, 'chains/b/pipeline.md', '---\nname: Pipeline B\nnodes: []\nedges: []\n---\n')
  write(wp, 'chains/other.md', '---\nname: Other\nnodes: []\nedges: []\n---\n')

  const ws = loadWorkspace(wp)
  assert.deepStrictEqual(ws.chains.map(c => c.slug), ['other'])
  const warning = ws.warnings.find(w => w.entityType === 'chain' && w.name === 'pipeline')
  assert.ok(warning)
})

// #151: GET /api/workspace still returns 200 with everything else loaded, warnings attached.
test('GET /api/workspace survives a clash and reports it in warnings', async () => {
  const wp = newWorkspace()
  write(wp, 'agents/creative/fixer.md', '---\nname: Fixer A\n---\nbody\n')
  write(wp, 'agents/scratch/fixer.md', '---\nname: Fixer B\n---\nbody\n')
  write(wp, 'agents/critic.md', '---\nname: Critic\n---\nbody\n')

  const res = await workspaceGET()
  assert.strictEqual(res.status, 200)
  const body = await res.json()
  assert.deepStrictEqual(body.agents.map((a: { slug: string }) => a.slug), ['critic'])
  assert.ok(body.warnings.some((w: { name: string }) => w.name === 'fixer'))
})

// #151: a chain node addressing a clashing agent name is refused with the clash message,
// not a plain "not found".
test('a chain node referencing a clashing agent name is refused with the clash reason', () => {
  const wp = newWorkspace()
  write(wp, 'agents/creative/fixer.md', '---\nname: Fixer A\n---\nbody\n')
  write(wp, 'agents/scratch/fixer.md', '---\nname: Fixer B\n---\nbody\n')

  const ws = loadWorkspace(wp)
  const chain = {
    slug: 'uses-fixer',
    name: 'Uses fixer',
    description: '',
    filePath: '',
    nodes: [{ id: 'n1', kind: 'agent' as const, agent: 'fixer' }],
    edges: [],
  }
  const result = validateChain(chain, ws)
  assert.strictEqual(result.valid, false)
  assert.ok(result.errors.some(e => e.includes('Two agents are named "fixer"') && e.includes('creative') && e.includes('scratch')))
})

// #151: a subchain node addressing a clashing chain name gets the same treatment.
test('a subchain node referencing a clashing chain name is refused with the clash reason', () => {
  const wp = newWorkspace()
  write(wp, 'chains/a/pipeline.md', '---\nname: Pipeline A\nnodes: []\nedges: []\n---\n')
  write(wp, 'chains/b/pipeline.md', '---\nname: Pipeline B\nnodes: []\nedges: []\n---\n')

  const ws = loadWorkspace(wp)
  const chain = {
    slug: 'host',
    name: 'Host',
    description: '',
    filePath: '',
    nodes: [{ id: 'n1', kind: 'subchain' as const, subchain: 'pipeline' }],
    edges: [],
  }
  const result = validateChain(chain, ws)
  assert.strictEqual(result.valid, false)
  assert.ok(result.errors.some(e => e.includes('Two chains are named "pipeline"')))
})

// #151: saving a new variant id that clashes with another agent's name is refused, not written.
test('PUT refuses to save a variant id that would newly clash with another agent', async () => {
  const wp = newWorkspace()
  write(wp, 'agents/base.md', '---\nname: Base\n---\nBase body.\n')
  write(wp, 'agents/critic.md', '---\nname: Critic\n---\nCritic body.\n')

  const putReq = new NextRequest('http://localhost/api/workspace/agent/base', {
    method: 'PUT',
    body: JSON.stringify({
      data: { name: 'Base', variants: [{ id: 'critic' }] },
      content: 'Base body.',
    }),
  })
  const res = await entityPUT(putReq, { params: Promise.resolve({ type: 'agent', slug: 'base' }) })
  assert.strictEqual(res.status, 409)
  const body = await res.json()
  assert.ok(body.error.includes('critic'))

  // Refused before the write landed.
  assert.ok(fs.readFileSync(path.join(wp, 'agents', 'base.md'), 'utf-8').includes('name: Base'))
  assert.ok(!fs.readFileSync(path.join(wp, 'agents', 'base.md'), 'utf-8').includes('variants'))
})

function putAgent(slug: string, data: Record<string, unknown>) {
  const req = new NextRequest(`http://localhost/api/workspace/agent/${slug}`, {
    method: 'PUT',
    body: JSON.stringify({ data, content: 'body' }),
  })
  return entityPUT(req, { params: Promise.resolve({ type: 'agent', slug }) })
}

test('PUT refuses a variant id that is already clashing between two other files', async () => {
  const wp = newWorkspace()
  write(wp, 'agents/creative/fixer.md', '---\nname: Fixer A\n---\nbody\n')
  write(wp, 'agents/scratch/fixer.md', '---\nname: Fixer B\n---\nbody\n')
  write(wp, 'agents/base.md', '---\nname: Base\n---\nbody\n')

  const res = await putAgent('base', { name: 'Base', variants: [{ id: 'fixer' }] })
  assert.strictEqual(res.status, 409)
  assert.ok((await res.json()).error.includes('fixer'))
})

test('PUT still saves a file whose variant already clashes, so it can be edited out', async () => {
  const wp = newWorkspace()
  write(wp, 'agents/rewriter.md', '---\nname: Rewriter\nvariants:\n  - id: critic\n---\nbody\n')
  write(wp, 'agents/critic.md', '---\nname: Critic\n---\nbody\n')

  const res = await putAgent('rewriter', { name: 'Rewriter v2', variants: [{ id: 'critic' }] })
  assert.strictEqual(res.status, 200)
})

test('POST refuses a new agent file named like an existing variant', async () => {
  const wp = newWorkspace()
  write(wp, 'agents/rewriter.md', '---\nname: Rewriter\nvariants:\n  - id: critic\n---\nbody\n')

  const req = new NextRequest('http://localhost/api/workspace', {
    method: 'POST',
    body: JSON.stringify({ type: 'agent', name: 'Critic', slug: 'critic' }),
  })
  const res = await workspacePOST(req)
  assert.strictEqual(res.status, 409)
  assert.ok((await res.json()).error.includes('rewriter.md'))
  assert.ok(!fs.existsSync(path.join(wp, 'agents', 'critic.md')))
})

test('an agent naming a clashing tool is refused with the clash reason', () => {
  const wp = newWorkspace()
  write(wp, 'tools/a/search.md', '---\nexecutor: retrieve\n---\ndesc\n')
  write(wp, 'tools/b/search.md', '---\nexecutor: retrieve\n---\ndesc\n')
  write(wp, 'agents/finder.md', '---\nname: Finder\ntools: [search]\n---\nbody\n')

  const ws = loadWorkspace(wp)
  const chain = {
    slug: 'find',
    name: 'Find',
    description: '',
    filePath: '',
    nodes: [{ id: 'n1', kind: 'agent' as const, agent: 'finder' }],
    edges: [],
  }
  const result = validateChain(chain, ws)
  assert.ok(result.errors.includes('Two tools are named "search": a/search.md, b/search.md'))
})

test('a pinned run keeps the clash reason for a clashing name', () => {
  const wp = newWorkspace()
  write(wp, 'agents/creative/fixer.md', '---\nname: Fixer A\n---\nbody\n')
  write(wp, 'agents/scratch/fixer.md', '---\nname: Fixer B\n---\nbody\n')

  const pinned = pinnedWorkspace(diskWorkspace(wp), loadWorkspace(wp), {})
  assert.ok(!('error' in pinned))
  const chain = {
    slug: 'uses-fixer',
    name: 'Uses fixer',
    description: '',
    filePath: '',
    nodes: [{ id: 'n1', kind: 'agent' as const, agent: 'fixer' }],
    edges: [],
  }
  assert.ok(validateChain(chain, pinned).errors.some(e => e.startsWith('Two agents are named "fixer"')))
})
