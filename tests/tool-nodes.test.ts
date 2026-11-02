import { test, afterEach, vi, expect } from 'vitest'
import fs from 'fs'
import os from 'os'
import path from 'path'
import type { AgentOutput } from '../lib/types'
import { requestEntry } from './helpers/requestWorkspace'

vi.mock('@/lib/requestWorkspace', () => import('./helpers/requestWorkspace'))
const { draw, retrieve, model } = vi.hoisted(() => ({ draw: vi.fn(), retrieve: vi.fn(), model: vi.fn() }))
vi.mock('../lib/tools/novelaiExecutor', () => ({ novelaiExecutor: draw }))
vi.mock('../lib/tools/retrieveExecutor', () => ({ retrieveExecutor: retrieve }))
vi.mock('../lib/runner', () => ({ runAgent: model }))

const roots: string[] = []
afterEach(() => {
  vi.resetAllMocks()
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true })
})

function workspace() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'tool-node-'))
  roots.push(root)
  requestEntry.root = root
  const write = (file: string, text: string) => {
    const target = path.join(root, file)
    fs.mkdirSync(path.dirname(target), { recursive: true })
    fs.writeFileSync(target, text)
  }
  write('tools/novelai.md', `---
name: novelai
executor: novelai
parts:
  character:
  clothes:
  scene:
params:
  aspect:
    type: string
    enum: ['2:3', '3:2', '1:1']
config:
  seed: 123
---
Draw.
`)
  draw.mockImplementation((_params, config, ctx) => ({
    result: `seed ${config.seed}`,
    images: [ctx.images.save(`img-${config.seed}.webp`, new Uint8Array([1]))],
  }))
  return { root, write }
}

async function launch(body: object) {
  const { POST } = await import('../app/api/run/route')
  const response = await POST({ json: async () => body } as import('next/server').NextRequest)
  return eventsFrom(response)
}

async function eventsFrom(response: Response) {
  expect(response.status, await response.clone().text()).toBe(200)
  const text = await response.text()
  return text.split('\n\n').flatMap(frame => {
    const data = frame.split('\n').find(line => line.startsWith('data: '))
    return data ? [JSON.parse(data.slice(6))] : []
  })
}

const outputOf = (events: Awaited<ReturnType<typeof launch>>, node = 'novelai'): AgentOutput =>
  events.find(e => e.type === 'agent_done' && e.nodeId === node)?.output

test('a standalone tool draws without a model and records its tool entrypoint', async () => {
  const { root } = workspace()
  const events = await launch({ toolName: 'novelai', inputs: { character: 'silver hair' } })
  expect(events.at(-1).type).toBe('run_complete')
  expect(model).not.toHaveBeenCalled()
  expect(draw).toHaveBeenCalledTimes(1)
  expect(draw.mock.calls[0][3]).toEqual([{ name: 'character', value: 'silver hair' }])
  expect(outputOf(events).output).toMatch(/^## Images\n\n!\[\]\(\/api\/runs\/.*\/images\/img-123.webp\)$/)
  const runId = events[0].runId
  const meta = JSON.parse(fs.readFileSync(path.join(root, 'logs', runId, 'meta.json'), 'utf8'))
  expect(meta.entrypoint).toEqual({ kind: 'tool', slug: 'novelai' })
  expect(meta.versions['tool/novelai']).toBeGreaterThan(0)
})

test('count makes three sequential drawings with successive fixed seeds and keeps run image overrides', async () => {
  workspace()
  let active = 0
  const save = draw.getMockImplementation()!
  draw.mockImplementation(async (...args) => {
    expect(++active).toBe(1)
    await Promise.resolve()
    active--
    return save(...args)
  })
  const events = await launch({ toolName: 'novelai', inputs: { character: 'silver hair', count: 3 }, imageOverride: { size: 'small' } })
  expect(events.at(-1).type).toBe('run_complete')
  expect(model).not.toHaveBeenCalled()
  expect(draw.mock.calls.map(call => call[1].seed)).toEqual([123, 124, 125])
  expect(draw.mock.calls[0][2].imageOverride).toEqual({ size: 'small' })
  expect(outputOf(events).output.match(/!\[\]/g)).toHaveLength(3)
})

test('unconfigured seeds are drawn separately and stay distinct even on a random collision', async () => {
  const { write } = workspace()
  write('tools/novelai.md', '---\nname: novelai\nexecutor: novelai\nparts:\n  character:\n---\nDraw.\n')
  const random = vi.spyOn(Math, 'random').mockReturnValue(0.5)
  try {
    await launch({ toolName: 'novelai', inputs: { character: 'silver hair', count: 3 } })
    expect(draw.mock.calls.map(call => call[1].seed)).toEqual([2147483648, 2147483649, 2147483650])
    expect(random).toHaveBeenCalledTimes(3)
  } finally { random.mockRestore() }
})

test('a tool with a seed-like slug has distinct seed nodes', async () => {
  const { write } = workspace()
  write('tools/character-seed.md', '---\nname: portrait\nexecutor: novelai\nparts:\n  character:\n---\nDraw.\n')
  const events = await launch({ toolName: 'character-seed', inputs: { character: 'silver hair' } })
  expect(outputOf(events, 'character-seed').status).toBe('success')
})

test('extra NovelAI parameters cannot replace the distinct seeds of a count run', async () => {
  const { write } = workspace()
  write('tools/novelai.md', '---\nname: novelai\nexecutor: novelai\nparts:\n  character:\nconfig:\n  seed: 123\n  parameters:\n    seed: 999\n    steps: 20\n---\nDraw.\n')
  await launch({ toolName: 'novelai', inputs: { character: 'silver hair', count: 3 } })
  expect(draw.mock.calls.map(call => call[1].parameters)).toEqual([
    { seed: 123, steps: 20 }, { seed: 124, steps: 20 }, { seed: 125, steps: 20 },
  ])
})

test('an invalid enum fails the node before calling its executor', async () => {
  workspace()
  const events = await launch({ toolName: 'novelai', inputs: { character: 'silver hair', aspect: '4:5' } })
  expect(outputOf(events).status).toBe('error')
  expect(outputOf(events).error).toBe('aspect must be one of 2:3, 3:2, 1:1')
  expect(draw).not.toHaveBeenCalled()
})

test('an omitted part uses its tool default while an explicit blank part is left out', async () => {
  const { write } = workspace()
  write('tools/novelai.md', `---
name: novelai
executor: novelai
parts:
  character: default character
  scene: default scene
---
Draw.
`)
  await launch({ toolName: 'novelai', inputs: { scene: '' } })
  expect(draw.mock.calls[0][3]).toEqual([{ name: 'character', value: 'default character' }])
})

test('a designer feeds its named sections straight into a tool and the log records the resolved call', async () => {
  model.mockImplementation(async (agent, systemPrompt) => ({
    agentName: agent.name, systemPrompt, input: '', output: '## Character\nsilver hair\n\n## Clothes\nred coat',
    tokensIn: 1, tokensOut: 1, costUsd: 0, latencyMs: 0, model: 'fake', timestamp: new Date().toISOString(), status: 'success',
  }))
  const { write } = workspace()
  write('agents/designer.md', '---\nname: designer\noutputs:\n  - name: Character\n  - name: Clothes\n---\nDesign.\n')
  const events = await launch({ chain: { nodes: [
    { id: 'designer', kind: 'agent', agent: 'designer' },
    { id: 'picture', kind: 'tool', tool: 'novelai' },
  ], edges: [
    { fromNode: 'designer', fromSocket: 'character', toNode: 'picture', toSocket: 'character' },
    { fromNode: 'designer', fromSocket: 'clothes', toNode: 'picture', toSocket: 'clothes' },
  ] } })
  expect(model).toHaveBeenCalledTimes(1)
  expect(draw.mock.calls[0][3]).toEqual([{ name: 'character', value: 'silver hair' }, { name: 'clothes', value: 'red coat' }])
  expect(outputOf(events, 'picture').toolCalls?.[0].args).toEqual({ character: 'silver hair', clothes: 'red coat' })
})

test('workspace metadata lists ordered parts and parameter definitions and advertises tool nodes', async () => {
  workspace()
  const { GET } = await import('../app/api/workspace/route')
  const data = await (await GET()).json()
  expect(data.capabilities.toolNodes).toBe(true)
  expect(data.tools[0].parts.map((p: { name: string }) => p.name)).toEqual(['character', 'clothes', 'scene'])
  expect(data.tools[0].params.aspect).toEqual({ type: 'string', enum: ['2:3', '3:2', '1:1'] })
  expect(data.tools[0].savesImages).toBe(true)
})

test.each(['current', 'pinned'])('resume and a %s fork past a tool reuse its image without drawing again', async versions => {
  workspace()
  const events = await launch({ chain: { nodes: [
    { id: 'seed', kind: 'seed' },
    { id: 'novelai', kind: 'tool', tool: 'novelai' },
    { id: 'hold', kind: 'hold' },
    { id: 'after', kind: 'report' },
  ], edges: [
    { fromNode: 'seed', fromSocket: 'output', toNode: 'novelai', toSocket: 'character' },
    { fromNode: 'novelai', fromSocket: 'output', toNode: 'hold', toSocket: 'in' },
    { fromNode: 'hold', fromSocket: 'output', toNode: 'after', toSocket: 'in' },
  ] }, seedPrompt: 'silver hair' })
  expect(events.at(-1).type).toBe('run_waiting')
  const runId = events[0].runId
  const { POST: resume } = await import('../app/api/runs/[runId]/resume/route')
  const resumed = await eventsFrom(await resume(
    { json: async () => ({ direction: 'approved' }) } as import('next/server').NextRequest,
    { params: Promise.resolve({ runId }) },
  ))
  expect(resumed.at(-1).type).toBe('run_complete')
  const { POST: fork } = await import('../app/api/runs/[runId]/fork/route')
  const forked = await eventsFrom(await fork(
    { json: async () => ({ from: 'after', versions }) } as import('next/server').NextRequest,
    { params: Promise.resolve({ runId }) },
  ))
  expect(outputOf(forked).output).toBe(outputOf(events).output)
  expect(draw).toHaveBeenCalledTimes(1)
  expect(model).not.toHaveBeenCalled()
})

test('retrieve runs directly and refuses the image-only count input', async () => {
  const { write } = workspace()
  write('tools/retrieve.md', '---\nname: retrieve\nexecutor: retrieve\nparams:\n  query:\n    type: string\n---\nSearch.\n')
  retrieve.mockReturnValue('### lore.md\nFound the castle.')
  const events = await launch({ toolName: 'retrieve', inputs: { query: 'castle' } })
  expect(outputOf(events, 'retrieve').output).toBe('### lore.md\nFound the castle.')
  expect(model).not.toHaveBeenCalled()
  const { POST } = await import('../app/api/run/route')
  const refused = await POST({ json: async () => ({ toolName: 'retrieve', inputs: { count: 3 } }) } as import('next/server').NextRequest)
  expect(refused.status).toBe(400)
  expect((await refused.json()).error).toContain('count')
  expect(retrieve).toHaveBeenCalledTimes(1)
})

test.each(['0', '9', '1.5', 'abc'])('invalid count %s fails before drawing', async count => {
  workspace()
  const events = await launch({ toolName: 'novelai', inputs: { character: 'silver hair', count } })
  expect(outputOf(events).status).toBe('error')
  expect(outputOf(events).error).toBe('count must be a whole number from 1 to 8')
  expect(draw).not.toHaveBeenCalled()
})

test('an executor error fails the tool node and keeps its failed call in the log', async () => {
  workspace()
  draw.mockRejectedValue(new Error('NovelAI unavailable'))
  const events = await launch({ toolName: 'novelai', inputs: { character: 'silver hair' } })
  expect(outputOf(events).status).toBe('error')
  expect(outputOf(events).error).toBe('NovelAI unavailable')
  expect(outputOf(events).toolCalls?.[0].isError).toBe(true)
  expect(model).not.toHaveBeenCalled()
})

test('a tool in a loop runs each round and records its round', async () => {
  workspace()
  const events = await launch({ chain: { nodes: [
    { id: 'seed', kind: 'seed' },
    { id: 'start', kind: 'loop-start', zone: 'z', state: ['character'] },
    { id: 'picture', kind: 'tool', tool: 'novelai', zone: 'z' },
    { id: 'end', kind: 'loop-end', zone: 'z', until: 'false', maxIterations: 2 },
  ], edges: [
    { fromNode: 'seed', fromSocket: 'output', toNode: 'start', toSocket: 'character' },
    { fromNode: 'start', fromSocket: 'character', toNode: 'picture', toSocket: 'character' },
    { fromNode: 'picture', fromSocket: 'output', toNode: 'end', toSocket: 'character' },
  ] }, seedPrompt: 'silver hair' })
  expect(events.filter(e => e.type === 'agent_done' && e.nodeId === 'picture').map(e => e.output.round)).toEqual([0, 1])
  expect(draw).toHaveBeenCalledTimes(2)
})
