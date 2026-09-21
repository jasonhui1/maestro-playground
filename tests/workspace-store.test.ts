// tests/workspace-store.test.ts
import { test, beforeEach } from 'vitest'
import assert from 'node:assert'
import { useWorkspaceStore, EMPTY_FILES, type WorkspaceFiles } from '../hooks/store/useWorkspaceStore'
import { useToastStore } from '../hooks/store/useToastStore'
import { WorkspaceTab } from '../lib/types'

const ROOT = '/ws'

function agent(slug: string, folder = '') {
  return {
    name: slug, slug, model: 'm', description: '', skills: [], context: [],
    input_from: 'user', output_format: 'markdown' as const, outputs: [], inputs: [],
    systemPrompt: '', filePath: `${ROOT}/agents/${folder ? folder + '/' : ''}${slug}.md`,
  }
}

function list(over: Partial<WorkspaceFiles> = {}): WorkspaceFiles {
  return { ...EMPTY_FILES, ...over }
}

/** Replies to each request from `routes`, keyed by `METHOD path` with the query dropped. */
function stubFetch(routes: Record<string, () => { status?: number; body?: unknown }>) {
  const seen: string[] = []
  global.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input)
    const key = `${init?.method ?? 'GET'} ${url.split('?')[0]}`
    seen.push(key)
    const route = routes[key]
    if (!route) throw new Error(`no stub for ${key}`)
    const { status = 200, body = {} } = route()
    return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
  }) as typeof fetch
  return seen
}

const toasts = () => useToastStore.getState().toasts.map(t => `${t.type}:${t.message}`)

beforeEach(() => {
  useWorkspaceStore.setState({ files: EMPTY_FILES, root: undefined, emptyFolders: {}, loaded: false, error: null })
  useToastStore.setState({ toasts: [] })
})

test('workspace-store — create then list shows the new file', async () => {
  let agents = [agent('one')]
  stubFetch({
    'GET /api/workspace': () => ({ body: list({ agents }) }),
    'POST /api/workspace': () => { agents = [agent('one'), agent('two')]; return { body: { success: true, slug: 'two' } } },
    'GET /api/workspace/folders': () => ({ body: { folders: [] } }),
  })

  await useWorkspaceStore.getState().load()
  assert.deepStrictEqual(useWorkspaceStore.getState().files.agents.map(a => a.slug), ['one'])

  const out = await useWorkspaceStore.getState().create({ type: 'agent', name: 'two' })
  assert.strictEqual(out.ok, true)
  assert.strictEqual(out.ok && out.slug, 'two')
  assert.deepStrictEqual(useWorkspaceStore.getState().files.agents.map(a => a.slug), ['one', 'two'])
  assert.deepStrictEqual(toasts(), ['success:Created agent: two'])
})

test('workspace-store — move then list reports the file in its new folder', async () => {
  let agents = [agent('one')]
  stubFetch({
    'GET /api/workspace': () => ({ body: list({ agents }) }),
    'PATCH /api/workspace/agent/one': () => { agents = [agent('one', 'deep')]; return { body: { success: true } } },
    'GET /api/workspace/folders': () => ({ body: { folders: ['deep'] } }),
  })

  await useWorkspaceStore.getState().load()
  const out = await useWorkspaceStore.getState().move({ type: 'agent', slug: 'one', name: 'one' }, 'deep')

  assert.strictEqual(out.ok, true)
  assert.strictEqual(useWorkspaceStore.getState().files.agents[0].filePath, `${ROOT}/agents/deep/one.md`)
  assert.deepStrictEqual(useWorkspaceStore.getState().emptyFolders.agent, ['deep'])
  assert.deepStrictEqual(toasts(), ['success:Moved one to deep'])
})

test('workspace-store — the workspace root comes off the loaded paths', async () => {
  stubFetch({ 'GET /api/workspace': () => ({ body: list({ agents: [agent('one'), agent('two', 'deep')] }) }) })

  await useWorkspaceStore.getState().load()
  assert.strictEqual(useWorkspaceStore.getState().root, ROOT)
})

test('workspace-store — deleting the active file repoints the tabs at its successor', async () => {
  stubFetch({
    'GET /api/workspace': () => ({ body: list({ agents: [agent('one'), agent('two'), agent('three')] }) }),
    'DELETE /api/workspace/agent/two': () => ({ body: { success: true } }),
  })
  await useWorkspaceStore.getState().load()

  const open: WorkspaceTab[] = [
    { type: 'agent', slug: 'one', active: false },
    { type: 'agent', slug: 'two', active: true },
    { type: 'agent', slug: 'three', active: false },
  ]
  const out = await useWorkspaceStore.getState().remove({ type: 'agent', slug: 'two', name: 'two' }, { tabs: open, active: 'agent:two' })

  assert.strictEqual(out.ok, true)
  assert.ok(out.ok)
  assert.deepStrictEqual(out.tabs.tabs.map(t => `${t.type}:${t.slug}`), ['agent:one', 'agent:three'])
  assert.strictEqual(out.tabs.active, 'agent:three')
})

test('workspace-store — deleting the last open file leaves no tab to repoint at', async () => {
  stubFetch({
    'GET /api/workspace': () => ({ body: list({ agents: [agent('one')] }) }),
    'DELETE /api/workspace/agent/one': () => ({ body: { success: true } }),
  })
  await useWorkspaceStore.getState().load()

  const out = await useWorkspaceStore.getState().remove(
    { type: 'agent', slug: 'one', name: 'one' },
    { tabs: [{ type: 'agent', slug: 'one', active: true }], active: 'agent:one' },
  )

  assert.ok(out.ok)
  assert.deepStrictEqual(out.tabs, { tabs: [], active: null })
})

test('workspace-store — a name clash is inline where a form is open, a toast where none is', async () => {
  stubFetch({
    'GET /api/workspace': () => ({ body: list({ agents: [agent('one')] }) }),
    'POST /api/workspace': () => ({ status: 409, body: { error: 'an agent named `one` already exists' } }),
    'PATCH /api/workspace/agent/one': () => ({ status: 409, body: { error: 'a file named `one` is already there' } }),
  })
  await useWorkspaceStore.getState().load()

  // create runs from a modal: the message goes back to the form, which stays open
  const created = await useWorkspaceStore.getState().create({ type: 'agent', name: 'one' })
  assert.strictEqual(created.ok, false)
  assert.strictEqual(!created.ok && created.inline, 'an agent named `one` already exists')
  assert.deepStrictEqual(toasts(), [])

  // move runs from a drag: nothing is open to hold the message, so it is toasted
  const moved = await useWorkspaceStore.getState().move({ type: 'agent', slug: 'one', name: 'one' }, 'deep')
  assert.strictEqual(moved.ok, false)
  assert.strictEqual(!moved.ok && moved.inline, null)
  assert.deepStrictEqual(toasts(), ['error:a file named `one` is already there'])
})

test('workspace-store — a failure that is not a name clash toasts even from a form', async () => {
  stubFetch({
    'GET /api/workspace': () => ({ body: list() }),
    'POST /api/workspace': () => ({ status: 500, body: { error: 'disk is full' } }),
  })
  await useWorkspaceStore.getState().load()

  const out = await useWorkspaceStore.getState().create({ type: 'agent', name: 'one' })
  assert.strictEqual(!out.ok && out.inline, null)
  assert.deepStrictEqual(toasts(), ['error:disk is full'])
})

test('workspace-store — a rename repoints every tab at the new slug', async () => {
  let agents = [agent('one')]
  stubFetch({
    'GET /api/workspace': () => ({ body: list({ agents }) }),
    'POST /api/workspace/agent/one/rename': () => { agents = [agent('uno')]; return { body: { success: true } } },
  })
  await useWorkspaceStore.getState().load()

  const out = await useWorkspaceStore.getState().rename({ type: 'agent', slug: 'one' }, 'uno', {
    tabs: [{ type: 'agent', slug: 'one', active: true }],
    active: 'agent:one',
  })

  assert.ok(out.ok)
  assert.deepStrictEqual(out.tabs.tabs.map(t => `${t.type}:${t.slug}`), ['agent:uno'])
  assert.strictEqual(out.tabs.active, 'agent:uno')
  assert.deepStrictEqual(useWorkspaceStore.getState().files.agents.map(a => a.slug), ['uno'])
})

test('workspace-store — a rename plan that names a taken slug stays in the dialog', async () => {
  stubFetch({
    'GET /api/workspace': () => ({ body: list({ agents: [agent('one'), agent('two')] }) }),
    'GET /api/workspace/agent/one/rename': () => ({ status: 409, body: { error: 'taken' } }),
  })
  await useWorkspaceStore.getState().load()

  const out = await useWorkspaceStore.getState().planRename({ type: 'agent', slug: 'one' }, 'two')
  assert.strictEqual(!out.ok && out.inline, 'taken')
  assert.deepStrictEqual(toasts(), [])
})

test('workspace-store — a workspace that will not load reports the error once', async () => {
  stubFetch({ 'GET /api/workspace': () => ({ status: 500, body: { error: 'no workspace' } }) })

  await useWorkspaceStore.getState().load()
  assert.strictEqual(useWorkspaceStore.getState().error, 'no workspace')
  assert.strictEqual(useWorkspaceStore.getState().loaded, true)
})

test("workspace-store — a write's refetch does not join a read already in flight", async () => {
  // The read is issued before the create lands, so joining it would show the list without
  // the new file and leave it missing until something else refetched.
  let agents = [agent('one')]
  let release = () => {}
  const held = new Promise<void>(resolve => { release = resolve })
  let first = true

  global.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input)
    if (url === '/api/workspace' && (init?.method ?? 'GET') === 'GET') {
      const snapshot = agents
      if (first) { first = false; await held }
      return new Response(JSON.stringify(list({ agents: snapshot })), { status: 200 })
    }
    if (url === '/api/workspace') { agents = [agent('one'), agent('two')]; return new Response(JSON.stringify({ slug: 'two' }), { status: 200 }) }
    return new Response(JSON.stringify({ folders: [] }), { status: 200 })
  }) as typeof fetch

  const slowRead = useWorkspaceStore.getState().load()
  const created = useWorkspaceStore.getState().create({ type: 'agent', name: 'two' })
  release()
  await Promise.all([slowRead, created])

  assert.deepStrictEqual(useWorkspaceStore.getState().files.agents.map(a => a.slug), ['one', 'two'])
})

test('workspace-store — concurrent loads share one request', async () => {
  const seen = stubFetch({ 'GET /api/workspace': () => ({ body: list({ agents: [agent('one')] }) }) })

  await Promise.all([
    useWorkspaceStore.getState().load(),
    useWorkspaceStore.getState().load(),
    useWorkspaceStore.getState().load(),
  ])

  assert.deepStrictEqual(seen, ['GET /api/workspace'])
})
