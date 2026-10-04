import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { NextRequest } from 'next/server'
import { GET, PUT } from '../app/api/workspace/[type]/[slug]/route'
import { saveWorkspaceEntity } from '../lib/fs/save'
import { WorkspaceSaveConflict } from '../lib/fs/errors'
import { editedFileKey, useEditedFileStore } from '../hooks/store/useEditedFileStore'

let root: string
vi.mock('../lib/requestWorkspace', () => ({ requestWorkspace: () => ({ root }) }))

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'maestro-save-'))
  fs.mkdirSync(path.join(root, 'agents'))
})
afterEach(() => {
  useEditedFileStore.setState({ byFile: {} })
  useEditedFileStore.getState().release({ type: 'agent', slug: 'writer' })
  vi.unstubAllGlobals()
  vi.useRealTimers()
  fs.rmSync(root, { recursive: true, force: true })
})

const params = (slug = 'writer') => ({ params: Promise.resolve({ type: 'agent', slug }) })
const put = (body: Record<string, unknown>, slug = 'writer') => PUT(new NextRequest('http://localhost/api/workspace/agent/' + slug, {
  method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
}), params(slug))
const read = (slug = 'writer') => GET(new NextRequest('http://localhost/api/workspace/agent/' + slug), params(slug))
const original = '---\nname: Writer\nmodel: test/model\n---\nOriginal\n'
const update = { data: { name: 'Writer', model: 'test/model' }, content: 'Mine\n' }

test('a save conflicts when the approved file changes while confirmation is open', async () => {
  const file = path.join(root, 'agents/writer.md')
  fs.writeFileSync(file, original)
  const approved = await (await read()).json()
  fs.writeFileSync(file, 'Another writer changed this while confirmation was open\n')
  const res = await put({ ...update, expectedRaw: approved.raw })
  expect(res.status).toBe(409)
  expect(await res.json()).toMatchObject({ code: 'SAVE_CONFLICT', currentRaw: 'Another writer changed this while confirmation was open\n' })
  expect(fs.readFileSync(file, 'utf8')).toBe('Another writer changed this while confirmation was open\n')
})

test('the successful receipt identifies our serialized write even after a later writer saves', async () => {
  const file = path.join(root, 'agents/writer.md')
  fs.writeFileSync(file, original)
  const res = await put({ ...update, expectedRaw: original })
  expect(res.status).toBe(200)
  const receipt = await res.json()
  expect(receipt.raw).toBe(fs.readFileSync(file, 'utf8'))
  expect(receipt.raw).toContain('Mine\n')
  fs.writeFileSync(file, 'Foreign version\n')
  expect(receipt.raw).not.toBe((await (await read()).json()).raw)
  expect((await put({ ...update, content: 'Second save', expectedRaw: receipt.raw })).status).toBe(409)
  expect(fs.readFileSync(file, 'utf8')).toBe('Foreign version\n')
})

test('two cooperating requests approving the same text cannot both overwrite it', async () => {
  fs.writeFileSync(path.join(root, 'agents/writer.md'), original)
  const responses = await Promise.all([
    put({ ...update, content: 'Plugin\n', expectedRaw: original }),
    put({ ...update, content: 'Editor\n', expectedRaw: original }),
  ])
  expect(responses.map(r => r.status).sort()).toEqual([200, 409])
  const winner = await responses.find(r => r.status === 200)!.json()
  expect(fs.readFileSync(path.join(root, 'agents/writer.md'), 'utf8')).toBe(winner.raw)
})

test('a missing-file approval cannot overwrite a competing creation', async () => {
  expect((await read()).status).toBe(404)
  const created = await put({ ...update, content: 'Created elsewhere\n', expectedRaw: null })
  expect(created.status).toBe(200)
  const receipt = await created.json()
  const loser = await put({ ...update, expectedRaw: null })
  expect(loser.status).toBe(409)
  expect(await loser.json()).toMatchObject({ code: 'SAVE_CONFLICT', currentRaw: receipt.raw })
})

test('deletion after inspection returns a missing-file conflict and does not recreate', async () => {
  fs.writeFileSync(path.join(root, 'agents/writer.md'), original)
  const approved = await (await read()).json()
  fs.unlinkSync(path.join(root, 'agents/writer.md'))
  const res = await put({ ...update, expectedRaw: approved.raw })
  expect(res.status).toBe(409)
  expect(await res.json()).toMatchObject({ currentRaw: null })
  expect(fs.existsSync(path.join(root, 'agents/writer.md'))).toBe(false)
})

test('omitting the condition keeps legacy overwrite behavior and adds a receipt', async () => {
  fs.writeFileSync(path.join(root, 'agents/writer.md'), 'Foreign text')
  const res = await put(update)
  expect(res.status).toBe(200)
  expect((await res.json()).raw).toBe(fs.readFileSync(path.join(root, 'agents/writer.md'), 'utf8'))
})

test.each([false, 42, {}, []])('a malformed condition %j is refused rather than becoming unconditional', async expectedRaw => {
  fs.writeFileSync(path.join(root, 'agents/writer.md'), original)
  expect((await put({ ...update, expectedRaw })).status).toBe(400)
  expect(fs.readFileSync(path.join(root, 'agents/writer.md'), 'utf8')).toBe(original)
})

test('variant saves compare and write the nested declaring file and return its storage identity', async () => {
  const file = path.join(root, 'agents/creative/premortem.md')
  fs.mkdirSync(path.dirname(file))
  const raw = '---\nname: Premortem\nmodel: test/model\nvariants:\n  - id: rot\n---\nBody\n'
  fs.writeFileSync(file, raw)
  const inspected = await (await read('rot')).json()
  expect(inspected.raw).toBe(raw)
  const data = { name: 'Premortem', model: 'test/model', variants: [{ id: 'rot' }] }
  const res = await put({ data, content: 'Updated body\n', expectedRaw: raw }, 'rot')
  expect(res.status).toBe(200)
  const receipt = await res.json()
  expect(receipt).toMatchObject({ slug: 'premortem', filePath: file })
  expect(receipt.raw).toBe(fs.readFileSync(file, 'utf8'))
  expect(fs.existsSync(path.join(root, 'agents/rot.md'))).toBe(false)
  expect(fs.existsSync(path.join(root, 'agents/premortem.md'))).toBe(false)
  expect((await put({ data, content: 'Stale body', expectedRaw: raw }, 'rot')).status).toBe(409)
})

test('the save module detects completed direct filesystem edits before writing', () => {
  const file = path.join(root, 'agents/writer.md')
  fs.writeFileSync(file, 'Direct disk edit')
  expect(() => saveWorkspaceEntity(root, { type: 'agent', slug: 'writer', ...update, expectedRaw: original })).toThrow(WorkspaceSaveConflict)
  expect(fs.readFileSync(file, 'utf8')).toBe('Direct disk edit')
})

test('create-only uses exclusive creation if a disk writer creates after the comparison', () => {
  const file = path.join(root, 'agents/writer.md')
  const write = fs.writeFileSync.bind(fs)
  const competingWrite = vi.spyOn(fs, 'writeFileSync').mockImplementationOnce((...args) => {
    write(file, 'Created by a direct writer')
    return write(...args)
  })
  try {
    expect(() => saveWorkspaceEntity(root, { type: 'agent', slug: 'writer', ...update, expectedRaw: null })).toThrow(WorkspaceSaveConflict)
    expect(fs.readFileSync(file, 'utf8')).toBe('Created by a direct writer')
  } finally {
    competingWrite.mockRestore()
  }
})

async function openEditor(afterPut?: (response: Response) => Promise<void>) {
  vi.useFakeTimers()
  vi.stubGlobal('EventSource', undefined)
  vi.stubGlobal('fetch', async (url: string, init?: RequestInit) => {
    const request = new NextRequest('http://localhost' + url, { method: init?.method, headers: init?.headers, body: init?.body })
    if (init?.method !== 'PUT') return GET(request, params())
    const response = await PUT(request, params())
    await afterPut?.(response)
    return response
  })
  const ref = { type: 'agent', slug: 'writer' }
  useEditedFileStore.getState().acquire(ref)
  await vi.advanceTimersByTimeAsync(0)
  return { ref, state: () => useEditedFileStore.getState().byFile[editedFileKey(ref)] }
}

test('the real editor and plugin-style PUTs recheck each approved version while conflicts are open', async () => {
  const file = path.join(root, 'agents/writer.md')
  fs.writeFileSync(file, original)
  const { ref, state } = await openEditor()
  useEditedFileStore.getState().setContent(ref, original.replace('Original', 'Editor'))
  const first = await (await put({ ...update, content: 'Plugin first\n', expectedRaw: original })).json()
  await vi.advanceTimersByTimeAsync(2000)
  expect(state().conflict).toBe(first.raw)
  useEditedFileStore.getState().resolve(ref, 'mine')
  const second = await (await put({ ...update, content: 'Plugin second\n', expectedRaw: first.raw })).json()
  await vi.advanceTimersByTimeAsync(2000)
  expect(state().conflict).toBe(second.raw)
  expect(fs.readFileSync(file, 'utf8')).toBe(second.raw)
  useEditedFileStore.getState().resolve(ref, 'mine')
  await vi.advanceTimersByTimeAsync(2000)
  expect(state().conflict).toBeNull()
  expect(state().onDisk).toBe(fs.readFileSync(file, 'utf8'))
  expect(state().onDisk).toContain('Editor\n')
})

test('the editor keeps its own receipt if another writer saves before its HTTP response is consumed', async () => {
  const file = path.join(root, 'agents/writer.md')
  fs.writeFileSync(file, original)
  let intervened = false
  let ownRaw = ''
  const { ref, state } = await openEditor(async response => {
    if (intervened || response.status !== 200) return
    intervened = true
    ownRaw = (await response.clone().json()).raw
    await put({ ...update, content: 'Foreign version\n', expectedRaw: ownRaw })
  })
  useEditedFileStore.getState().setContent(ref, original.replace('Original', 'Editor'))
  await vi.advanceTimersByTimeAsync(2000)
  expect(state().onDisk).toBe(ownRaw)
  expect(fs.readFileSync(file, 'utf8')).toContain('Foreign version\n')
  useEditedFileStore.getState().setContent(ref, original.replace('Original', 'Editor second'))
  await vi.advanceTimersByTimeAsync(2000)
  expect(state().conflict).toContain('Foreign version\n')
  expect(fs.readFileSync(file, 'utf8')).toContain('Foreign version\n')
})
