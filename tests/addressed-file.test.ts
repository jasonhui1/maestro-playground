import { test, afterEach, vi } from 'vitest'
import assert from 'node:assert'
import fs from 'fs'
import path from 'path'
import os from 'os'
import { NextRequest } from 'next/server'
import {
  resolveAddressedFile,
  findAgentFile,
  declaringAgentSlug,
  type EntityType,
} from '../lib/fs/workspace'
import { snapshotVersion } from '../lib/fs/versions'
import { GET as versionsGET } from '../app/api/workspace/[type]/[slug]/versions/route'
import { GET as watchGET } from '../app/api/watch/route'
import {
  GET as entityGET,
  PUT as entityPUT,
  PATCH as entityPATCH,
} from '../app/api/workspace/[type]/[slug]/route'
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
  const wp = fs.mkdtempSync(path.join(os.tmpdir(), 'ws-addressed-file-'))
  requestEntry.root = wp
  return wp
}

const PREMORTEM = [
  '---',
  'name: Premortem',
  'variants:',
  '  - id: rot',
  '    name: "Root cause: rot"',
  '  - id: burnout',
  '---',
  'Post-mortem body.',
  '',
].join('\n')

// #118, #123: resolveAddressedFile across regular agents, variants, and other entity types.
test('resolveAddressedFile maps variants to declaring file and preserves entity slugs', () => {
  const wp = newWorkspace()
  const agentPath = write(wp, 'agents/premortem.md', PREMORTEM)
  const plainPath = write(wp, 'agents/plain.md', '---\nname: Plain\n---\nPlain agent body.\n')
  const skillPath = write(wp, 'skills/concise.md', '---\nname: Concise\n---\nBe brief.\n')
  const chainPath = write(wp, 'chains/decision.md', '---\nname: Decision\nnodes: []\nedges: []\n---\n')
  const templatePath = write(wp, 'templates/base.md', '---\nname: Base\n---\nTemplate.\n')
  const toolPath = write(wp, 'tools/search.md', '---\nname: Search\n---\nTool.\n')
  const contextPath = write(wp, 'context/brand.md', 'Brand guidelines.\n')

  // Agent variant resolves to declaring file
  const variantRes = resolveAddressedFile(wp, 'agent', 'rot')
  assert.strictEqual(variantRes.filePath, agentPath)
  assert.strictEqual(variantRes.storageSlug, 'premortem')

  // Regular agent resolves to its own file
  const plainRes = resolveAddressedFile(wp, 'agent', 'plain')
  assert.strictEqual(plainRes.filePath, plainPath)
  assert.strictEqual(plainRes.storageSlug, 'plain')

  // Other entity types
  assert.deepStrictEqual(resolveAddressedFile(wp, 'skill', 'concise'), { filePath: skillPath, storageSlug: 'concise' })
  assert.deepStrictEqual(resolveAddressedFile(wp, 'chain', 'decision'), { filePath: chainPath, storageSlug: 'decision' })
  assert.deepStrictEqual(resolveAddressedFile(wp, 'template', 'base'), { filePath: templatePath, storageSlug: 'base' })
  assert.deepStrictEqual(resolveAddressedFile(wp, 'tool', 'search'), { filePath: toolPath, storageSlug: 'search' })
  assert.deepStrictEqual(resolveAddressedFile(wp, 'context', 'brand'), { filePath: contextPath, storageSlug: 'brand' })

  // Custom variants map override and own-file precedence (#118, #123)
  const customVariants = new Map([['custom', { filePath: agentPath, fileSlug: 'premortem' }]])
  assert.deepStrictEqual(resolveAddressedFile(wp, 'agent', 'custom', customVariants), { filePath: agentPath, storageSlug: 'premortem' })
  const shadowVariants = new Map([['plain', { filePath: agentPath, fileSlug: 'premortem' }]])
  assert.deepStrictEqual(resolveAddressedFile(wp, 'agent', 'plain', shadowVariants), { filePath: plainPath, storageSlug: 'plain' })

  // Invalid entity type throws
  assert.throws(() => resolveAddressedFile(wp, 'invalid' as EntityType, 'foo'), /Invalid entity type/)
})

// #118, #123: findAgentFile and declaringAgentSlug over resolveAddressedFile.
test('findAgentFile and declaringAgentSlug resolve variants and report undefined when missing', () => {
  const wp = newWorkspace()
  const agentPath = write(wp, 'agents/premortem.md', PREMORTEM)
  const plainPath = write(wp, 'agents/plain.md', '---\nname: Plain\n---\nPlain agent body.\n')

  assert.strictEqual(findAgentFile(wp, 'rot'), agentPath)
  assert.strictEqual(declaringAgentSlug(wp, 'rot'), 'premortem')

  assert.strictEqual(findAgentFile(wp, 'plain'), plainPath)
  assert.strictEqual(declaringAgentSlug(wp, 'plain'), 'plain')

  assert.strictEqual(findAgentFile(wp, 'missing'), undefined)
  assert.strictEqual(declaringAgentSlug(wp, 'missing'), undefined)
})

// #118: tolerant variant index does not fail lookups when sibling agent files are malformed.
test('malformed variants block in one file does not break lookups of other agents or variants', () => {
  const wp = newWorkspace()
  const agentPath = write(wp, 'agents/premortem.md', PREMORTEM)
  write(wp, 'agents/broken-variants.md', '---\nname: Broken\nvariants: 42\n---\nbody\n')
  write(wp, 'agents/invalid-yaml.md', '---\n: bad: yaml\n---\nbody\n')
  const plainPath = write(wp, 'agents/plain.md', '---\nname: Plain\n---\nPlain agent body.\n')

  // Variant lookup in premortem succeeds despite broken files
  assert.strictEqual(findAgentFile(wp, 'rot'), agentPath)
  assert.strictEqual(declaringAgentSlug(wp, 'rot'), 'premortem')

  // Regular agent lookup succeeds
  assert.strictEqual(findAgentFile(wp, 'plain'), plainPath)
  assert.strictEqual(declaringAgentSlug(wp, 'plain'), 'plain')

  const res = resolveAddressedFile(wp, 'agent', 'rot')
  assert.strictEqual(res.filePath, agentPath)
  assert.strictEqual(res.storageSlug, 'premortem')
})

// #123: variant versions query uses storageSlug to access declaring file snapshots.
test('a variant versions tab lists its declaring file snapshots', async () => {
  const wp = newWorkspace()
  write(wp, 'agents/premortem.md', PREMORTEM)

  snapshotVersion(wp, 'agent', 'premortem', 'v1 snapshot')
  snapshotVersion(wp, 'agent', 'premortem', 'v2 snapshot')

  // List versions for variant 'rot'
  const listReq = new NextRequest('http://localhost/api/workspace/agent/rot/versions')
  const listRes = await versionsGET(listReq, { params: Promise.resolve({ type: 'agent', slug: 'rot' }) })
  assert.strictEqual(listRes.status, 200)
  const listData = await listRes.json()
  assert.ok(Array.isArray(listData))
  assert.strictEqual(listData.length, 2)
  assert.strictEqual(listData[0].version, 2)
  assert.strictEqual(listData[1].version, 1)

  // Fetch version 1 content for variant 'rot'
  const getReq = new NextRequest('http://localhost/api/workspace/agent/rot/versions?version=1')
  const getRes = await versionsGET(getReq, { params: Promise.resolve({ type: 'agent', slug: 'rot' }) })
  assert.strictEqual(getRes.status, 200)
  const getData = await getRes.json()
  assert.strictEqual(getData.content, 'v1 snapshot')

  // Invalid entity type returns 400
  const badReq = new NextRequest('http://localhost/api/workspace/invalid/rot/versions')
  const badRes = await versionsGET(badReq, { params: Promise.resolve({ type: 'invalid', slug: 'rot' }) })
  assert.strictEqual(badRes.status, 400)
})

// #123: watching a variant resolves to declaring file and streams updates.
test('watching a variant resolves to declaring file and streams updates', async () => {
  const wp = newWorkspace()
  const agentPath = write(wp, 'agents/premortem.md', PREMORTEM)

  const { filePath } = resolveAddressedFile(wp, 'agent', 'rot')
  assert.strictEqual(filePath, agentPath)

  const ac = new AbortController()
  const req = new NextRequest('http://localhost/api/watch?type=agent&slug=rot', { signal: ac.signal })
  const res = await watchGET(req)
  assert.strictEqual(res.status, 200)
  assert.strictEqual(res.headers.get('content-type'), 'text/event-stream')

  const reader = res.body!.getReader()
  const decoder = new TextDecoder()

  // Wait briefly for chokidar watcher registration
  await new Promise(r => setTimeout(r, 300))

  const updatedContent = PREMORTEM + '\n# Appended note\n'
  fs.writeFileSync(agentPath, updatedContent)

  const received: { event: { type: string; raw: string } | null } = { event: null }
  const readLoop = (async () => {
    while (!received.event) {
      const { value, done } = await reader.read()
      if (done) break
      const text = decoder.decode(value)
      for (const line of text.split('\n')) {
        if (line.startsWith('data: ')) {
          try {
            const parsed = JSON.parse(line.slice(6))
            if (parsed.type === 'change') {
              received.event = parsed
              return
            }
          } catch {}
        }
      }
    }
  })()

  await Promise.race([
    readLoop,
    new Promise(r => setTimeout(r, 4000)),
  ])

  ac.abort()
  await reader.cancel().catch(() => {})

  assert.ok(received.event, 'watch stream did not receive change event')
  assert.strictEqual(received.event.type, 'change')
  assert.strictEqual(received.event.raw, updatedContent)
})

// #118, #123: entity route GET/PUT/PATCH operate on declaring file without ternaries.
test('entity route GET, PUT, and PATCH handle variants via resolveAddressedFile', async () => {
  const wp = newWorkspace()
  const agentPath = write(wp, 'agents/premortem.md', PREMORTEM)

  // GET opens declaring file
  const getReq = new NextRequest('http://localhost/api/workspace/agent/rot')
  const getRes = await entityGET(getReq, { params: Promise.resolve({ type: 'agent', slug: 'rot' }) })
  assert.strictEqual(getRes.status, 200)
  const getData = await getRes.json()
  assert.ok(getData.raw.includes('Root cause: rot'))

  // PUT updates declaring file, does not create rot.md
  const putReq = new NextRequest('http://localhost/api/workspace/agent/rot', {
    method: 'PUT',
    body: JSON.stringify({
      data: { name: 'Premortem Updated', variants: [{ id: 'rot' }, { id: 'burnout' }] },
      content: 'Updated post-mortem body.',
    }),
  })
  const putRes = await entityPUT(putReq, { params: Promise.resolve({ type: 'agent', slug: 'rot' }) })
  assert.strictEqual(putRes.status, 200)
  assert.ok(fs.readFileSync(agentPath, 'utf-8').includes('Premortem Updated'))
  assert.ok(!fs.existsSync(path.join(wp, 'agents', 'rot.md')))

  // PATCH rejects moving a variant
  const patchReq = new NextRequest('http://localhost/api/workspace/agent/rot', {
    method: 'PATCH',
    body: JSON.stringify({ folder: 'subfolder' }),
  })
  const patchRes = await entityPATCH(patchReq, { params: Promise.resolve({ type: 'agent', slug: 'rot' }) })
  assert.strictEqual(patchRes.status, 400)
  const patchData = await patchRes.json()
  assert.strictEqual(patchData.error, '"rot" is a variant declared in premortem.md — edit that file instead.')
})
