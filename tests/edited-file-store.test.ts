// tests/edited-file-store.test.ts
// The wiring around the fold — load, debounce, PUT, watch, refcounting — with a stubbed
// fetch and a stubbed EventSource, so it runs with no DOM.
import { test, beforeEach, afterEach, vi } from 'vitest'
import assert from 'node:assert'
import { useEditedFileStore, editedFileKey } from '../hooks/store/useEditedFileStore'

const REF = { type: 'agent', slug: 'writer' }
const KEY = editedFileKey(REF)
const FILE = '/api/workspace/agent/writer'
const RAW = '---\nname: writer\n---\nbody\n'

interface Write { data: Record<string, unknown>; content: string }

let disk: string
let writes: Write[]
let fail: string | null
/** When set, each PUT parks here until the test releases it. */
let park: (() => void)[] | null
/** The frames the route would push, replayed by hand so the test controls the timing. */
let push: (raw: string) => void
let closed: number

function stub() {
  disk = RAW
  writes = []
  fail = null
  park = null
  closed = 0

  global.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input)
    if (!url.startsWith(FILE)) throw new Error(`no stub for ${url}`)
    if (init?.method === 'PUT') {
      if (park) await new Promise<void>(release => park!.push(release))
      if (fail) return new Response(JSON.stringify({ error: fail }), { status: 500 })
      const body = JSON.parse(String(init.body)) as Write
      writes.push(body)
      disk = `---\nname: ${body.data.name}\n---\n${body.content}`
      return new Response('{}', { status: 200 })
    }
    return new Response(JSON.stringify({ raw: disk }), { status: 200 })
  }) as typeof fetch

  class FakeEventSource {
    onmessage: ((e: { data: string }) => void) | null = null
    constructor(public url: string) { push = raw => this.onmessage?.({ data: JSON.stringify({ type: 'change', raw }) }) }
    close() { closed += 1 }
  }
  ;(globalThis as { EventSource?: unknown }).EventSource = FakeEventSource
}

/** A valid agent file whose body is `text`. */
const body = (text: string) => `---
name: writer
---
${text}
`

/** Let the stubbed fetch's promises settle. */
const settle = async () => { for (let i = 0; i < 4; i++) await Promise.resolve() }

beforeEach(() => {
  vi.useFakeTimers()
  stub()
  useEditedFileStore.setState({ byFile: {} })
})

afterEach(() => {
  // Sessions live in a module Map, so a test that leaves one open would be handed back to
  // the next one: drop the state first, so the last release has no pending edit to flush.
  useEditedFileStore.setState({ byFile: {} })
  for (let i = 0; i < 5; i++) useEditedFileStore.getState().release(REF)
  vi.useRealTimers()
})

const open = async () => {
  useEditedFileStore.getState().acquire(REF)
  await settle()
}
const state = () => useEditedFileStore.getState().byFile[KEY]

test('edited-file-store — opening a file loads it and starts watching', async () => {
  await open()
  assert.strictEqual(state().content, RAW)
  assert.strictEqual(state().loaded, true)
  assert.strictEqual(state().status, 'idle')
})

test('edited-file-store — an edit writes once the debounce elapses', async () => {
  await open()
  useEditedFileStore.getState().setContent(REF, '---\nname: writer\n---\nedited\n')
  assert.strictEqual(writes.length, 0, 'no write before the debounce')

  await vi.advanceTimersByTimeAsync(2000)
  await settle()
  assert.strictEqual(writes.length, 1)
  assert.strictEqual(writes[0].content.trim(), 'edited')
  assert.strictEqual(state().status, 'saved')
})

test('edited-file-store — typing again restarts the debounce, so one write lands', async () => {
  await open()
  useEditedFileStore.getState().setContent(REF, '---\nname: writer\n---\none\n')
  await vi.advanceTimersByTimeAsync(1500)
  useEditedFileStore.getState().setContent(REF, '---\nname: writer\n---\ntwo\n')
  await vi.advanceTimersByTimeAsync(2000)
  await settle()
  assert.strictEqual(writes.length, 1)
  assert.strictEqual(writes[0].content.trim(), 'two')
})

test('edited-file-store — a rejected write surfaces its message', async () => {
  await open()
  fail = 'disk full'
  useEditedFileStore.getState().setContent(REF, '---\nname: writer\n---\nedited\n')
  await vi.advanceTimersByTimeAsync(2000)
  await settle()
  assert.strictEqual(state().status, 'error')
  assert.strictEqual(state().error, 'disk full')
})

test('edited-file-store — invalid frontmatter is not written', async () => {
  await open()
  useEditedFileStore.getState().setContent(REF, '---\n: :\n- ]\n---\nbody\n')
  await vi.advanceTimersByTimeAsync(2000)
  await settle()
  assert.strictEqual(writes.length, 0)
  assert.strictEqual(state().status, 'idle')
  assert.strictEqual(state().error, null)
})

test('edited-file-store — a change on disk is adopted while the buffer is clean', async () => {
  await open()
  push('---\nname: writer\n---\nfrom vs code\n')
  assert.strictEqual(state().content.trim().endsWith('from vs code'), true)
  assert.strictEqual(state().conflict, null)
  assert.strictEqual(state().externalRevision, 1 + 1, 'load bumped it once, the adopt again')
})

test('edited-file-store — a change on disk conflicts while the buffer is dirty', async () => {
  await open()
  useEditedFileStore.getState().setContent(REF, '---\nname: writer\n---\nmine\n')
  push('---\nname: writer\n---\ntheirs\n')
  assert.strictEqual(state().conflict?.trim().endsWith('theirs'), true)
  assert.strictEqual(state().content.trim().endsWith('mine'), true)

  useEditedFileStore.getState().resolve(REF, 'mine')
  assert.strictEqual(state().conflict, null)
  await vi.advanceTimersByTimeAsync(2000)
  await settle()
  assert.strictEqual(writes.at(-1)?.content.trim(), 'mine', 'keeping mine writes it over disk')
})

test('edited-file-store — our own write echoes back without raising a conflict', async () => {
  await open()
  useEditedFileStore.getState().setContent(REF, '---\nname: writer\n---\nedited\n')
  await vi.advanceTimersByTimeAsync(2000)
  await settle()
  push(disk)
  assert.strictEqual(state().conflict, null)
  assert.strictEqual(state().status, 'saved')
})

test('edited-file-store — two views share one session, one load and one watch', async () => {
  await open()
  useEditedFileStore.getState().acquire(REF)
  await settle()

  useEditedFileStore.getState().setContent(REF, '---\nname: writer\n---\nedited\n')
  // The second view sees the first view's status, so there is no second channel.
  assert.strictEqual(state().content.trim().endsWith('edited'), true)

  useEditedFileStore.getState().release(REF)
  assert.notStrictEqual(state(), undefined, 'one view still holds it open')
  assert.strictEqual(closed, 0)

  useEditedFileStore.getState().release(REF)
  assert.strictEqual(state(), undefined)
  assert.strictEqual(closed, 1)
})

test('edited-file-store — closing the last view writes a debounce that had not fired', async () => {
  await open()
  useEditedFileStore.getState().setContent(REF, '---\nname: writer\n---\nunsaved\n')
  useEditedFileStore.getState().release(REF)
  await settle()
  assert.strictEqual(writes.length, 1)
  assert.strictEqual(writes[0].content.trim(), 'unsaved')
})

test('edited-file-store — a second write waits for the one in flight, then follows it', async () => {
  await open()
  park = []
  useEditedFileStore.getState().setContent(REF, body('first'))
  await vi.advanceTimersByTimeAsync(2000)
  await settle()
  assert.strictEqual(park.length, 1, 'the first write is in flight')

  // Typing mid-write must not start a second PUT alongside the first.
  useEditedFileStore.getState().setContent(REF, body('second'))
  await vi.advanceTimersByTimeAsync(2000)
  await settle()
  assert.strictEqual(park.length, 1, 'no overlapping write')

  park.shift()!()
  await settle()
  await vi.advanceTimersByTimeAsync(2000)
  await settle()
  park.shift()?.()
  await settle()

  assert.deepStrictEqual(writes.map(w => w.content.trim()), ['first', 'second'])
  assert.strictEqual(state().onDisk.trim().endsWith('second'), true)
  assert.strictEqual(state().content, state().onDisk, 'the buffer ends clean')
})

test('edited-file-store — a file that will not load reports the error', async () => {
  global.fetch = (async () => new Response('nope', { status: 500 })) as typeof fetch
  await open()
  assert.strictEqual(state().loadError, 'Failed to fetch file content')
  assert.strictEqual(state().loaded, false)
})
