import { test, afterEach, vi } from 'vitest'
import assert from 'node:assert'
import fs from 'fs'
import path from 'path'
import os from 'os'
import type { AgentOutput } from '../lib/types'
import type { LayoutModel } from '../lib/layoutModel'

// The only test in the repo that stands a module in for a real one: the contract under
// test is the frame sequence /api/run emits, and reaching it otherwise means calling a
// model. Everything else here is the real route over a real workspace on disk.
const hops: AgentOutput[] = []
vi.mock('@/lib/executor', () => ({
  runChainGraph: async (
    _chain: unknown, _agents: unknown, _skills: unknown, _seed: unknown, _wp: unknown,
    callbacks: { onStart: (n: string, a: string) => void; onDone: (n: string, o: AgentOutput) => void },
  ) => {
    for (const output of hops) {
      callbacks.onStart(output.nodeId!, output.agentName)
      callbacks.onDone(output.nodeId!, output)
    }
    return hops
  },
}))

const ORIGINAL_WORKSPACE = process.env.WORKSPACE_PATH

afterEach(() => {
  hops.length = 0
  if (ORIGINAL_WORKSPACE === undefined) delete process.env.WORKSPACE_PATH
  else process.env.WORKSPACE_PATH = ORIGINAL_WORKSPACE
})

function output(nodeId: string, text: string, round?: number): AgentOutput {
  return {
    nodeId, agentName: 'Relay', systemPrompt: '', input: '', output: text,
    tokensIn: 0, tokensOut: 0, costUsd: 0, latencyMs: 0, model: 'm',
    timestamp: '', status: 'success', round,
  }
}

const agentFile = `---
name: Relay
---
say something
`

function newWorkspace(chainFile: string, body: string) {
  const wp = fs.mkdtempSync(path.join(os.tmpdir(), 'ws-run-stream-'))
  process.env.WORKSPACE_PATH = wp
  write(wp, path.join('chains', chainFile), body)
  write(wp, path.join('agents', 'relay.md'), agentFile)
  return wp
}

function write(root: string, rel: string, body: string) {
  const p = path.join(root, rel)
  fs.mkdirSync(path.dirname(p), { recursive: true })
  fs.writeFileSync(p, body)
}

const timelineChain = `---
name: relay
view: timeline
outputs:
  - name: hop 1
    node: first
    socket: summary
  - name: hop 2
    node: second
    socket: summary
nodes:
  - id: first
    kind: agent
    agent: relay
  - id: second
    kind: agent
    agent: relay
edges: []
---
`

const sidebarChain = `---
name: sidebar-chain
view: sidebar
outputs:
  - name: reflection
    node: loop
nodes:
  - id: loop
    kind: agent
    agent: relay
edges: []
---
`

const undeclaredChain = `---
name: plain
nodes:
  - id: first
    kind: agent
    agent: relay
edges: []
---
`

async function run(body: object): Promise<LayoutModel[]> {
  const { POST } = await import('../app/api/run/route')
  const req = { json: async () => body } as import('next/server').NextRequest
  const res = await POST(req)
  const text = await new Response(res.body).text()
  return text
    .split('\n\n')
    .flatMap(frame => {
      const line = frame.split('\n').find(l => l.startsWith('data: '))
      if (!line) return []
      const event = JSON.parse(line.slice(6)) as { type: string; model?: LayoutModel }
      return event.type === 'layout' && event.model ? [event.model] : []
    })
}

test('the panels exist before hop 1 and fill in one hop at a time', async () => {
  newWorkspace('relay.md', timelineChain)
  hops.push(output('first', '## Summary\nalpha'), output('second', '## Summary\nbeta'))

  const frames = await run({ chainName: 'relay', seedPrompt: 'go' })

  assert.strictEqual(frames.length, 3)
  assert.deepStrictEqual(frames.map(m => m.panels.map(p => p.state)), [
    ['pending', 'pending'],
    ['filled', 'pending'],
    ['filled', 'filled'],
  ])
  assert.deepStrictEqual(frames[2].panels.map(p => p.text), ['alpha', 'beta'])
})

// Without this the plugin overlaying live tokens has to match panels by display name.
test('every panel names the node its tokens arrive under', async () => {
  newWorkspace('relay.md', timelineChain)
  hops.push(output('first', 'a'), output('second', 'b'))

  const frames = await run({ chainName: 'relay', seedPrompt: 'go' })
  assert.deepStrictEqual(frames[0].panels.map(p => p.node), ['first', 'second'])
})

// The frames read the outputs as a list, so a loop body's earlier rounds are still
// there — a client keying by node alone would only ever see the last one (ADR-0016).
test('a sidebar chain streams one panel per round', async () => {
  newWorkspace('sidebar-chain.md', sidebarChain)
  hops.push(output('loop', 'round zero', 0), output('loop', 'round one', 1))

  const frames = await run({ chainName: 'sidebar-chain', seedPrompt: 'go' })
  assert.deepStrictEqual(frames.at(-1)!.panels.map(p => p.round), [0, 1])
  assert.deepStrictEqual(frames.at(-1)!.panels.map(p => p.text), ['round zero', 'round one'])
})

// A branched run replays its earlier hops straight into the graph without an onDone,
// so the first frame has to carry them or those panels read pending for the whole run.
test('a replayed branch output is already in the first frame', async () => {
  newWorkspace('relay.md', timelineChain)
  hops.push(output('second', '## Summary\nbeta'))

  const frames = await run({
    chainName: 'relay', seedPrompt: 'go',
    branchOutputs: [output('first', '## Summary\nalpha')],
  })
  assert.deepStrictEqual(frames[0].panels.map(p => p.state), ['filled', 'pending'])
})

// A chain that declares no view still gets frames; they just carry no panels, which is
// the client's cue to fall back to its own run trace (ADR-0015).
test('an undeclared chain streams an empty model rather than nothing', async () => {
  newWorkspace('plain.md', undeclaredChain)
  hops.push(output('first', 'text'))

  const frames = await run({ chainName: 'plain', seedPrompt: 'go' })
  assert.ok(frames.length > 0)
  for (const model of frames) assert.deepStrictEqual(model, { kind: 'undeclared', panels: [] })
})
