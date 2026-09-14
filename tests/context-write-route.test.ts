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

function newWorkspace() {
  const wp = fs.mkdtempSync(path.join(os.tmpdir(), 'ws-context-write-'))
  process.env.WORKSPACE_PATH = wp
  return wp
}

async function route() {
  return import('../app/api/context/[slug]/route')
}

async function callPUT(slug: string, body: string) {
  const { PUT } = await route()
  const request = { text: async () => body } as unknown as import('next/server').NextRequest
  const response = await PUT(request, { params: Promise.resolve({ slug }) })
  return { status: response.status, body: await response.json() }
}

test('writes the text body to workspace/context/<slug>.md', async () => {
  const wp = newWorkspace()
  const { status } = await callPUT('canon-anime-game', '## LOCKED\n- halo = burden\n')
  assert.strictEqual(status, 200)
  assert.strictEqual(
    fs.readFileSync(path.join(wp, 'context', 'canon-anime-game.md'), 'utf-8'),
    '## LOCKED\n- halo = burden\n',
  )
})

test('overwrites an existing file in place', async () => {
  const wp = newWorkspace()
  fs.mkdirSync(path.join(wp, 'context'), { recursive: true })
  fs.writeFileSync(path.join(wp, 'context', 'canon.md'), 'old')

  await callPUT('canon', 'new content')

  assert.strictEqual(fs.readFileSync(path.join(wp, 'context', 'canon.md'), 'utf-8'), 'new content')
})

test('rejects a slug that is not a single path segment', async () => {
  // Next.js decodes a %2F in a dynamic segment before the handler sees it, so a
  // slug value containing '/' is exactly what an encoded-separator request looks like here.
  newWorkspace()
  const { status, body } = await callPUT('foo/bar', 'x')
  assert.strictEqual(status, 400)
  assert.match(body.error, /single path segment/)
})

test('rejects a parent-traversal slug', async () => {
  const wp = newWorkspace()
  const { status } = await callPUT('../escape', 'x')
  assert.strictEqual(status, 400)
  assert.ok(!fs.existsSync(path.join(wp, 'escape.md')))
})

test('rejects an empty slug', async () => {
  newWorkspace()
  const { status } = await callPUT('', 'x')
  assert.strictEqual(status, 400)
})
