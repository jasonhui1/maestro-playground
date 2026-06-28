# Control Nodes — Loop Zones (Phase 3a-2) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.
>
> **Depends on Phase 3a-1** (gate/branch/decider + condition language + executor edge-liveness). Implement 3a-1 first.

**Goal:** Add Blender-style **loop zones** (`loop-start` / `loop-end`) for feedback / iterate-until workflows (patch → review → revise), with paired state sockets carried across iterations and a `maxIterations` cap.

**Architecture:** A loop zone is a `loop-start`/`loop-end` pair sharing a `zone` id, with body agents wired between them. The chain stays acyclic (state carry is implicit). The executor detects zones; when topo order reaches a `loop-start`, it runs the whole zone iteratively — emitting current state on `loop-start`'s sockets, running the body, reading new state at `loop-end`, and repeating until `until` holds or `maxIterations` is hit.

**Tech Stack:** Next.js 16 / React 19 / TypeScript, `gray-matter`, `@xyflow/react` + `dagre`, `tsx`.

**Spec:** [docs/maestro/plans/2026-06-28-control-flow-nodes-design.md](2026-06-28-control-flow-nodes-design.md) (implements §11's slice 3a-2).

## Global Constraints

- **Builds on 3a-1** — assumes `evalCondition`, `socketValue`, executor edge-liveness, and control types already exist.
- **Sequential only**; zones iterate sequentially.
- **Outer graph stays acyclic** — the loop carry (`loop-end` → `loop-start`) is implicit, not an edge; `topoOrder` is unchanged.
- **Zone boundary rule:** no edge crosses a zone boundary except into `loop-start` or out of `loop-end`.
- **Termination guaranteed** by a positive-integer `maxIterations`.
- **Loop body is agent/decider nodes only** in this slice (gate/branch *inside* a zone are out of scope; note it).
- **Pure modules are TDD** via `npx tsx tests/<name>.test.ts`. UI/example tasks use manual verification.

---

## File Structure

- Modify: `lib/types.ts` — add loop kinds to `ChainNodeKind`; `zone`/`state`/`until`/`maxIterations` on `ChainNode`; `round?` on `AgentOutput`.
- Modify: `lib/fs/parseChain.ts` — carry the loop fields.
- Modify: `lib/resolveNode.ts` — `socketValue` resolves `loop-start`/`loop-end` state sockets (compound keys).
- Modify: `lib/chainGraph.ts` — zone well-formedness + loop socket validation.
- Modify: `lib/executor.ts` — zone detection + iteration with state carry (refactor agent-run into a helper).
- Modify: `components/trace/RunNodePreview.tsx` — show per-round outputs for looped nodes.
- Create (example): `workspace/agents/patch-agent.md`, `workspace/agents/review-agent.md`, `workspace/chains/refine-loop.md`.
- Create tests: `tests/parse-loop.test.ts`, `tests/resolve-loop.test.ts`, `tests/validate-loop.test.ts`, `tests/executor-loop.test.ts`.

---

## Task 1: Types + parse loop fields

**Files:**
- Modify: `lib/types.ts`
- Modify: `lib/fs/parseChain.ts`
- Test: `tests/parse-loop.test.ts`

**Interfaces:**
- Produces:
  ```ts
  // ChainNodeKind adds 'loop-start' | 'loop-end'
  // ChainNode gains: zone?: string; state?: string[]; until?: string; maxIterations?: number
  // AgentOutput gains: round?: number   // loop iteration, 0-based
  ```

- [ ] **Step 1: Write the failing test**

Create `tests/parse-loop.test.ts`:
```ts
import assert from 'node:assert'
import { parseChainContent } from '../lib/fs/parseChain'

const raw = `---
name: demo
nodes:
  - { id: ls, kind: loop-start, zone: refine, state: [draft, feedback] }
  - { id: p, kind: agent, agent: patch-agent, zone: refine }
  - { id: le, kind: loop-end, zone: refine, until: '{p.output} contains "DONE"', maxIterations: 4 }
edges:
  - { from: ls.draft, to: p.previous }
---
`
const c = parseChainContent(raw, 'demo')
const ls = c.nodes.find(n => n.id === 'ls')!
assert.strictEqual(ls.kind, 'loop-start')
assert.strictEqual(ls.zone, 'refine')
assert.deepStrictEqual(ls.state, ['draft', 'feedback'])
const le = c.nodes.find(n => n.id === 'le')!
assert.strictEqual(le.until, '{p.output} contains "DONE"')
assert.strictEqual(le.maxIterations, 4)
assert.strictEqual(c.nodes.find(n => n.id === 'p')!.zone, 'refine')
console.log('✅ parse-loop tests passed')
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx tsx tests/parse-loop.test.ts`
Expected: FAIL — `zone`/`state`/`until` are `undefined`.

- [ ] **Step 3a: Extend `lib/types.ts`**

Change `ChainNodeKind` to add the loop kinds:
```ts
export type ChainNodeKind = 'seed' | 'context' | 'agent' | 'gate' | 'branch' | 'decider' | 'loop-start' | 'loop-end'
```
Add these fields to `ChainNode` (after `default?`):
```ts
  zone?: string          // loop-start / loop-end / body members
  state?: string[]       // loop-start: names of carried state items
  until?: string         // loop-end: exit condition
  maxIterations?: number // loop-end
```
Add to `AgentOutput` (after `nodeId?`):
```ts
  round?: number         // loop iteration (0-based), set for loop-body outputs
```

- [ ] **Step 3b: Carry loop fields in `parseChainContent`**

In `lib/fs/parseChain.ts`, extend the node mapping object with:
```ts
        zone: n.zone as string | undefined,
        state: Array.isArray(n.state) ? (n.state as unknown[]).map(String) : undefined,
        until: n.until as string | undefined,
        maxIterations: typeof n.maxIterations === 'number' ? n.maxIterations : undefined,
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx tsx tests/parse-loop.test.ts`
Expected: prints `✅ parse-loop tests passed`.

- [ ] **Step 5: Commit**

```bash
git add lib/types.ts lib/fs/parseChain.ts tests/parse-loop.test.ts
git commit -m "feat: loop-zone types + parse zone/state/until/maxIterations"
```

---

## Task 2: Resolve loop-start / loop-end state sockets

**Files:**
- Modify: `lib/resolveNode.ts`
- Test: `tests/resolve-loop.test.ts`

**Interfaces:**
- Extends `socketValue` (from 3a-1): `loop-start`/`loop-end` state values are stored in `nodeOutputs` under the compound key `` `${nodeId}::${socketSlug}` `` and read back per socket.

- [ ] **Step 1: Write the failing test**

Create `tests/resolve-loop.test.ts`:
```ts
import assert from 'node:assert'
import { socketValue } from '../lib/resolveNode'
import { ChainNode, AgentOutput } from '../lib/types'

function o(id: string, output: string): AgentOutput {
  return { nodeId: id, agentName: id, systemPrompt: '', input: '', output, tokensIn: 0, tokensOut: 0, costUsd: 0, latencyMs: 0, model: 'm', timestamp: '', status: 'success' }
}
const outs = new Map<string, AgentOutput>([
  ['ls::draft', o('ls::draft', 'CURRENT DRAFT')],
  ['ls::feedback', o('ls::feedback', '')],
  ['le::draft', o('le::draft', 'FINAL DRAFT')],
])
const read = (f: string) => `CTX:${f}`
const ls: ChainNode = { id: 'ls', kind: 'loop-start', state: ['draft', 'feedback'] }
const le: ChainNode = { id: 'le', kind: 'loop-end' }

assert.strictEqual(socketValue(ls, 'draft', outs, 'SEED', read), 'CURRENT DRAFT')
assert.strictEqual(socketValue(ls, 'feedback', outs, 'SEED', read), '')
assert.strictEqual(socketValue(le, 'draft', outs, 'SEED', read), 'FINAL DRAFT')
assert.strictEqual(socketValue(ls, 'missing', outs, 'SEED', read), '')
console.log('✅ resolve-loop tests passed')
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx tsx tests/resolve-loop.test.ts`
Expected: FAIL — loop kinds fall through to the agent branch and return `''` for `draft` (or wrong value).

- [ ] **Step 3: Extend `socketValue` in `lib/resolveNode.ts`**

Add this branch in `socketValue`, immediately after the `seed`/`context` handling and **before** the `gate`/`branch` handling:
```ts
  if (src.kind === 'loop-start' || src.kind === 'loop-end') {
    const o = nodeOutputs.get(`${src.id}::${slugify(socket)}`)
    return o ? o.output : ''
  }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx tsx tests/resolve-loop.test.ts` → `✅ resolve-loop tests passed`.
Run: `npx tsx tests/resolve-control.test.ts` and `npx tsx tests/resolve-node.test.ts` → still pass.

- [ ] **Step 5: Commit**

```bash
git add lib/resolveNode.ts tests/resolve-loop.test.ts
git commit -m "feat: resolve loop-start/loop-end state sockets"
```

---

## Task 3: Validate loop zones

**Files:**
- Modify: `lib/chainGraph.ts`
- Test: `tests/validate-loop.test.ts`

**Interfaces:**
- Extends `validateChain` to accept loop kinds and check zone well-formedness.

- [ ] **Step 1: Write the failing test**

Create `tests/validate-loop.test.ts`:
```ts
import assert from 'node:assert'
import { validateChain } from '../lib/chainGraph'
import { ChainDef, AgentDef } from '../lib/types'

function agent(slug: string, prompt: string): AgentDef {
  return { slug, name: slug, model: 'm', description: '', skills: [], context: [],
    input_from: 'user', output_format: 'markdown', outputs: [{ name: 'output' }], inputs: [], systemPrompt: prompt, filePath: '' }
}
const agents = [agent('patch', 'Prev: {previous}\nFb: {feedback}'), agent('review', 'Draft: {draft}'), agent('rep', 'Final: {in}')]

function chain(nodes: ChainDef['nodes'], edges: ChainDef['edges']): ChainDef {
  return { slug: 'c', name: 'c', description: '', nodes, edges, filePath: '' }
}
const good = chain(
  [
    { id: 'seed', kind: 'seed' },
    { id: 'ls', kind: 'loop-start', zone: 'r', state: ['draft', 'feedback'] },
    { id: 'patch', kind: 'agent', agent: 'patch', zone: 'r' },
    { id: 'review', kind: 'agent', agent: 'review', zone: 'r' },
    { id: 'le', kind: 'loop-end', zone: 'r', until: '{review.output} contains "OK"', maxIterations: 3 },
    { id: 'rep', kind: 'agent', agent: 'rep' },
  ],
  [
    { fromNode: 'seed', fromSocket: 'output', toNode: 'ls', toSocket: 'draft' },
    { fromNode: 'ls', fromSocket: 'draft', toNode: 'patch', toSocket: 'previous' },
    { fromNode: 'ls', fromSocket: 'feedback', toNode: 'patch', toSocket: 'feedback' },
    { fromNode: 'patch', fromSocket: 'output', toNode: 'review', toSocket: 'draft' },
    { fromNode: 'patch', fromSocket: 'output', toNode: 'le', toSocket: 'draft' },
    { fromNode: 'review', fromSocket: 'output', toNode: 'le', toSocket: 'feedback' },
    { fromNode: 'le', fromSocket: 'draft', toNode: 'rep', toSocket: 'in' },
  ],
)
assert.strictEqual(validateChain(good, agents).valid, true)

// missing loop-end
const noEnd = chain(good.nodes.filter(n => n.id !== 'le'), good.edges.filter(e => e.toNode !== 'le' && e.fromNode !== 'le'))
assert.ok(validateChain(noEnd, agents).errors.some(e => /loop-end/i.test(e)))

// bad maxIterations
const badMax = chain(good.nodes.map(n => n.id === 'le' ? { ...n, maxIterations: 0 } : n), good.edges)
assert.ok(validateChain(badMax, agents).errors.some(e => /maxIterations/i.test(e)))

// boundary-crossing edge (outside node -> body node, not via loop-start)
const cross = chain(good.nodes, [...good.edges, { fromNode: 'seed', fromSocket: 'output', toNode: 'review', toSocket: 'draft' }])
assert.ok(validateChain(cross, agents).errors.some(e => /zone boundary/i.test(e)))

console.log('✅ validate-loop tests passed')
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx tsx tests/validate-loop.test.ts`
Expected: FAIL — loop kinds rejected / zone checks missing.

- [ ] **Step 3a: Teach the socket helpers about loop kinds**

In `lib/chainGraph.ts`, first build a per-node zone-state lookup at the top of `validateChain` (after `nodeById`):
```ts
  const stateNamesByZone = new Map<string, string[]>()
  for (const n of chain.nodes) if (n.kind === 'loop-start' && n.zone) stateNamesByZone.set(n.zone, n.state || [])
  const zoneStateOf = (n: ChainNode): string[] => (n.zone ? stateNamesByZone.get(n.zone) || [] : [])
```
Extend `inputSlotsOf` to add (before the final `return`):
```ts
    if (n.kind === 'loop-start' || n.kind === 'loop-end') return zoneStateOf(n)
```
Extend `outputSocketsOf` to add (before the final agent return):
```ts
    if (n.kind === 'loop-start' || n.kind === 'loop-end') return zoneStateOf(n)
```
Extend `acceptsInputs` to include loop kinds:
```ts
  const acceptsInputs = (n: ChainNode): boolean =>
    n.kind === 'agent' || n.kind === 'decider' || n.kind === 'gate' || n.kind === 'branch' || n.kind === 'loop-start' || n.kind === 'loop-end'
```
Add the loop kinds to `allowedKinds`:
```ts
  const allowedKinds = new Set<string>(['seed', 'context', 'agent', 'gate', 'branch', 'decider', 'loop-start', 'loop-end'])
```

- [ ] **Step 3b: Add zone well-formedness checks**

In `lib/chainGraph.ts`, add this function and call it from `validateChain` (just before `return { valid, errors }`):
```ts
function validateZones(chain: ChainDef, errors: string[]) {
  const byZone = new Map<string, ChainNode[]>()
  for (const n of chain.nodes) {
    if (!n.zone) continue
    const arr = byZone.get(n.zone) ?? []
    arr.push(n); byZone.set(n.zone, arr)
  }
  const zoneOf = new Map(chain.nodes.map(n => [n.id, n.zone]))
  for (const [zid, members] of byZone) {
    const starts = members.filter(n => n.kind === 'loop-start')
    const ends = members.filter(n => n.kind === 'loop-end')
    if (starts.length !== 1) errors.push(`Zone "${zid}": needs exactly one loop-start (found ${starts.length})`)
    if (ends.length !== 1) errors.push(`Zone "${zid}": needs exactly one loop-end (found ${ends.length})`)
    const end = ends[0]
    if (end) {
      if (!end.until || !end.until.trim()) errors.push(`Zone "${zid}": loop-end needs an "until" condition`)
      if (!end.maxIterations || end.maxIterations < 1 || !Number.isInteger(end.maxIterations)) errors.push(`Zone "${zid}": loop-end needs a positive integer maxIterations`)
    }
  }
  // boundary rule: an edge between different zones is allowed only into loop-start or out of loop-end
  const kindOf = new Map(chain.nodes.map(n => [n.id, n.kind]))
  for (const e of chain.edges) {
    const fz = zoneOf.get(e.fromNode); const tz = zoneOf.get(e.toNode)
    if (fz === tz) continue
    const intoStart = kindOf.get(e.toNode) === 'loop-start'
    const outOfEnd = kindOf.get(e.fromNode) === 'loop-end'
    if (!intoStart && !outOfEnd) errors.push(`Edge "${e.fromNode}.${e.fromSocket}" -> "${e.toNode}.${e.toSocket}" crosses a zone boundary (only loop-start/loop-end may cross)`)
  }
}
```
Call site inside `validateChain`:
```ts
  validateZones(chain, errors)
  return { valid: errors.length === 0, errors }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx tsx tests/validate-loop.test.ts` → `✅ validate-loop tests passed`.
Run: `npx tsx tests/validate-control.test.ts` and `npx tsx tests/chain-graph.test.ts` → still pass.

- [ ] **Step 5: Commit**

```bash
git add lib/chainGraph.ts tests/validate-loop.test.ts
git commit -m "feat: validate loop zones (pair, until, maxIterations, boundary)"
```

---

## Task 4: Executor — run loop zones

**Files:**
- Modify: `lib/executor.ts`
- Test: `tests/executor-loop.test.ts`

**Interfaces:**
- Consumes: `socketValue` (Task 2), `evalCondition`, `topoOrder`, `resolveNodePrompt`, `injectSkills`.
- Produces: `runChainGraph` runs loop zones; body outputs carry `round`; signature unchanged.

- [ ] **Step 1: Write the failing test**

Create `tests/executor-loop.test.ts`:
```ts
import assert from 'node:assert'
import { runChainGraph } from '../lib/executor'
import { ChainDef, AgentDef, AgentOutput } from '../lib/types'

function agent(slug: string, prompt: string): AgentDef {
  return { slug, name: slug, model: 'm', description: '', skills: [], context: [],
    input_from: 'user', output_format: 'markdown', outputs: [{ name: 'output' }], inputs: [], systemPrompt: prompt, filePath: '' }
}
const noop = { onStart() {}, onToken() {}, onDone() {} }

// patch echoes the round number it sees via feedback; review approves on round 2.
const agents = [
  agent('patch', 'PREV={previous} FB={feedback}'),
  agent('review', 'DRAFT={draft}'),
  agent('rep', 'FINAL={in}'),
]

// Stub runner: patch outputs "draft-<n>" where n = count of APPROVE markers seen in feedback+1;
// review outputs APPROVED once the draft is "draft-3", else REVISE.
let patchCalls = 0
const stub = (async (a: AgentDef, sp: string) => {
  let output = ''
  if (a.slug === 'patch') { patchCalls++; output = `draft-${patchCalls}` }
  else if (a.slug === 'review') { output = sp.includes('draft-3') ? 'APPROVED' : 'REVISE' }
  else output = `REPORT(${sp})`
  return { agentName: a.name, systemPrompt: sp, input: '', output,
    tokensIn: 0, tokensOut: 0, costUsd: 0, latencyMs: 0, model: 'm', timestamp: '', status: 'success' } as AgentOutput
}) as never

const chain: ChainDef = {
  slug: 'c', name: 'c', description: '', filePath: '',
  nodes: [
    { id: 'seed', kind: 'seed' },
    { id: 'ls', kind: 'loop-start', zone: 'r', state: ['draft', 'feedback'] },
    { id: 'patch', kind: 'agent', agent: 'patch', zone: 'r' },
    { id: 'review', kind: 'agent', agent: 'review', zone: 'r' },
    { id: 'le', kind: 'loop-end', zone: 'r', until: '{review.output} contains "APPROVED"', maxIterations: 5 },
    { id: 'rep', kind: 'agent', agent: 'rep' },
  ],
  edges: [
    { fromNode: 'seed', fromSocket: 'output', toNode: 'ls', toSocket: 'draft' },
    { fromNode: 'ls', fromSocket: 'draft', toNode: 'patch', toSocket: 'previous' },
    { fromNode: 'ls', fromSocket: 'feedback', toNode: 'patch', toSocket: 'feedback' },
    { fromNode: 'patch', fromSocket: 'output', toNode: 'review', toSocket: 'draft' },
    { fromNode: 'patch', fromSocket: 'output', toNode: 'le', toSocket: 'draft' },
    { fromNode: 'review', fromSocket: 'output', toNode: 'le', toSocket: 'feedback' },
    { fromNode: 'le', fromSocket: 'draft', toNode: 'rep', toSocket: 'in' },
  ],
}

const res = await runChainGraph(chain, agents, [], 'SEED', '/ws', noop, stub)
// patch ran 3 times (draft-1, draft-2, draft-3 -> review APPROVED)
const patchRounds = res.filter(o => o.nodeId === 'patch')
assert.strictEqual(patchRounds.length, 3, 'patch ran 3 rounds')
assert.deepStrictEqual(patchRounds.map(o => o.round), [0, 1, 2], 'rounds tagged')
// report receives the final draft (draft-3)
const rep = res.find(o => o.nodeId === 'rep')!
assert.ok(rep.output.includes('draft-3'), 'final draft flows downstream')
console.log('✅ executor-loop tests passed')
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx tsx tests/executor-loop.test.ts`
Expected: FAIL — zones not executed (loop nodes treated as ordinary/skip).

- [ ] **Step 3: Update `lib/executor.ts`**

Add imports at the top (alongside existing ones):
```ts
import { ChainNode } from './types'
```
(If `ChainNode` is already imported in the existing import line, merge it instead of adding a duplicate.)

Inside `runChainGraph`, **after** the `inValue` helper and **before** the `for (const o of startOutputs)` replay loop, add the agent-run helper, zone precompute, and zone runner:
```ts
  const runAgentNode = async (node: ChainNode, agent: AgentDef, round?: number): Promise<AgentOutput> => {
    callbacks.onStart(node.id, agent.name)
    const body = resolveNodePrompt(node, chain, agent, nodeOutputs, seedPrompt, readContext)
    const systemPrompt = injectSkills(agent, skills, body)
    const output = await runFn(agent, systemPrompt, 'Follow your instructions.', (t, ty) => callbacks.onToken(node.id, t, ty))
    output.nodeId = node.id
    if (round !== undefined) output.round = round
    nodeOutputs.set(node.id, output); results.push(output); callbacks.onDone(node.id, output)
    return output
  }

  // --- zones ---
  interface Zone { id: string; startId: string; endId: string; bodyIds: string[]; stateNames: string[]; until: string; maxIterations: number }
  const zonesByStart = new Map<string, Zone>()
  const handledByZone = new Set<string>()
  {
    const byZone = new Map<string, ChainNode[]>()
    for (const n of chain.nodes) if (n.zone) { const a = byZone.get(n.zone) ?? []; a.push(n); byZone.set(n.zone, a) }
    for (const [zid, members] of byZone) {
      const start = members.find(n => n.kind === 'loop-start')
      const end = members.find(n => n.kind === 'loop-end')
      if (!start || !end) continue
      zonesByStart.set(start.id, {
        id: zid, startId: start.id, endId: end.id,
        bodyIds: members.filter(n => n.kind !== 'loop-start' && n.kind !== 'loop-end').map(n => n.id),
        stateNames: start.state || [], until: end.until || '', maxIterations: end.maxIterations || 1,
      })
    }
  }

  const edgeVal = (e: typeof chain.edges[number]): string => {
    const src = nodeById.get(e.fromNode)
    return src ? socketValue(src, e.fromSocket, nodeOutputs, seedPrompt, readContext) : ''
  }
  const setStateSockets = (nodeId: string, state: Map<string, string>) => {
    for (const [name, val] of state) nodeOutputs.set(`${nodeId}::${slugify(name)}`, controlOutput(`${nodeId}::${name}`, nodeId, val, 'success'))
  }
  const bodyOrder = (zone: Zone): string[] => {
    const set = new Set(zone.bodyIds)
    const indeg = new Map(zone.bodyIds.map(id => [id, 0]))
    const adj = new Map(zone.bodyIds.map(id => [id, [] as string[]]))
    for (const e of chain.edges) if (set.has(e.fromNode) && set.has(e.toNode)) { adj.get(e.fromNode)!.push(e.toNode); indeg.set(e.toNode, (indeg.get(e.toNode) || 0) + 1) }
    const q = zone.bodyIds.filter(id => (indeg.get(id) || 0) === 0)
    const order: string[] = []
    while (q.length) { const id = q.shift()!; order.push(id); for (const t of adj.get(id) || []) { indeg.set(t, (indeg.get(t) || 0) - 1); if ((indeg.get(t) || 0) === 0) q.push(t) } }
    return order
  }

  const runZone = async (zone: Zone) => {
    handledByZone.add(zone.startId); handledByZone.add(zone.endId); zone.bodyIds.forEach(id => handledByZone.add(id))
    const incoming = (id: string) => incomingByNode.get(id) || []
    // initial state
    const state = new Map<string, string>()
    for (const name of zone.stateNames) {
      const idx = incoming(zone.startId).find(i => chain.edges[i].toSocket === name)
      state.set(name, idx !== undefined ? edgeVal(chain.edges[idx]) : '')
    }
    const order = bodyOrder(zone)
    let finalState = state
    for (let round = 0; round < zone.maxIterations; round++) {
      setStateSockets(zone.startId, state)
      for (const id of order) {
        const bn = nodeById.get(id)!
        if (bn.kind === 'agent' || bn.kind === 'decider') {
          const a = bn.agent ? agentBySlug.get(bn.agent) : undefined
          if (a) await runAgentNode(bn, a, round)
        }
      }
      const newState = new Map<string, string>()
      for (const name of zone.stateNames) {
        const idx = incoming(zone.endId).find(i => chain.edges[i].toSocket === name)
        newState.set(name, idx !== undefined ? edgeVal(chain.edges[idx]) : (state.get(name) || ''))
      }
      finalState = newState
      if (evalCondition(zone.until, nodeOutputs)) break
      state.clear(); for (const [k, v] of newState) state.set(k, v)
    }
    setStateSockets(zone.endId, finalState)
    const rec = controlOutput(zone.endId, 'loop-end', '', 'success')
    nodeOutputs.set(zone.endId, rec); results.push(rec); callbacks.onDone(zone.endId, rec)
    markOut(zone.endId, () => true)
  }
```
Then, in the main `for (const nodeId of topoOrder(chain))` loop, add these two guards at the very top of the loop body (before the `if (!node ...)` handling):
```ts
    if (handledByZone.has(nodeId)) continue
    const startZone = zonesByStart.get(nodeId)
    if (startZone) {
      const inc = incomingByNode.get(nodeId) || []
      const anyLive = inc.length === 0 || inc.some(i => live.has(i))
      if (anyLive) { await runZone(startZone); continue }
      // zone is unreachable (blocked upstream): record members skipped
      for (const id of [startZone.startId, ...startZone.bodyIds, startZone.endId]) {
        handledByZone.add(id)
        const rec = controlOutput(id, nodeById.get(id)?.kind || 'node', '', 'skipped')
        nodeOutputs.set(id, rec); results.push(rec); callbacks.onDone(id, rec)
      }
      continue
    }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx tsx tests/executor-loop.test.ts` → `✅ executor-loop tests passed`.
Run: `npx tsx tests/executor-control.test.ts` and `npx tsx tests/executor.test.ts` → still pass.

- [ ] **Step 5: Commit**

```bash
git add lib/executor.ts tests/executor-loop.test.ts
git commit -m "feat: executor runs loop zones with state carry + maxIterations"
```

---

## Task 5: Trace shows per-round loop outputs

**Files:**
- Modify: `components/trace/RunNodePreview.tsx`

**Interfaces:**
- Consumes: `RunMeta.agentOutputs` may contain multiple entries with the same `nodeId` (one per loop round, each with `round`).

> `buildRunGraphFromSnapshot` already labels `loop-start`/`loop-end` by kind (3a-1's control-label change) and carries status, so the graph renders them with no further change. This task makes the preview show all rounds for a looped body node.

- [ ] **Step 1: Show all rounds in the preview**

In `components/trace/RunNodePreview.tsx`, in the agent branch (where it currently renders the single `output` for `node.stepIndex`), first gather every output for the node and, when there is more than one round, render each. Replace the single-output render with:
```tsx
  const rounds = run.agentOutputs.filter(o => o.nodeId === node.id)
  const items = rounds.length > 0 ? rounds : (node.stepIndex != null && run.agentOutputs[node.stepIndex] ? [run.agentOutputs[node.stepIndex]] : [])
  if (items.length === 0) return null

  return (
    <div className="border border-zinc-200 rounded-2xl overflow-hidden bg-white">
      {items.map((output, i) => (
        <div key={i} className="border-b border-zinc-100 last:border-b-0">
          {items.length > 1 && (
            <div className="px-6 pt-3 text-[10px] font-bold uppercase tracking-widest text-zinc-400">
              Round {output.round ?? i}
            </div>
          )}
          <div className="bg-zinc-50 px-6 py-4 border-b border-zinc-200 flex items-center justify-between gap-4">
            <div className="flex flex-col">
              <span className="text-sm font-bold text-zinc-900">{output.agentName}</span>
              <span className="text-[10px] font-medium text-zinc-400 uppercase tracking-wider">{output.model} • {output.latencyMs}ms</span>
            </div>
            {node.stepIndex != null && i === items.length - 1 && (
              <button
                onClick={() => node.stepIndex != null && onBranch(node.stepIndex)}
                disabled={isBranching}
                className="text-[10px] font-bold text-zinc-400 hover:text-zinc-900 border border-zinc-200 rounded-md px-3 py-1.5 transition-all hover:bg-zinc-50 disabled:opacity-50 whitespace-nowrap"
              >
                {isBranching ? 'BRANCHING...' : 'BRANCH FROM HERE'}
              </button>
            )}
          </div>
          <div className="p-4">
            <AgentStreamOutput {...output} isStreaming={false} />
          </div>
        </div>
      ))}
    </div>
  )
```
(Keep the existing `seed`/`context`/`skipped`/`!node` early-returns above this block unchanged. Remove the old single-output `return (...)` it replaces. `TokenCostBar` may be dropped from this view or kept per round — keeping it is optional.)

- [ ] **Step 2: Type-check**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add components/trace/RunNodePreview.tsx
git commit -m "feat: trace preview shows per-round outputs for looped nodes"
```

---

## Task 6: Example — refine-loop (patch ↔ review)

**Files:**
- Create: `workspace/agents/patch-agent.md`, `workspace/agents/review-agent.md`, `workspace/chains/refine-loop.md`

- [ ] **Step 1: Create the agents**

`workspace/agents/patch-agent.md`:
```markdown
---
name: patch-agent
model: anthropic/claude-3.5-sonnet
skills:
  - base-protocol
input_from: user
output_format: markdown
outputs:
  - summary
---

You are improving a piece of writing toward a goal.

Goal / previous draft:
{previous}

Reviewer feedback from the last round (may be empty on the first round):
{feedback}

Produce an improved draft. Output only the draft.
```
`workspace/agents/review-agent.md`:
```markdown
---
name: review-agent
model: anthropic/claude-3.5-sonnet
skills:
  - base-protocol
input_from: user
output_format: markdown
outputs:
  - summary
---

Review the draft below. If it fully meets the goal, reply with the single word APPROVED.
Otherwise give 2-3 concrete fixes and end with the word REVISE.

Draft:
{draft}
```

- [ ] **Step 2: Create the chain**

`workspace/chains/refine-loop.md`:
```markdown
---
name: refine-loop
description: Iterate patch <-> review until approved (or 5 rounds)
nodes:
  - { id: seed,   kind: seed, pos: [0, 0] }
  - { id: ls,     kind: loop-start, zone: refine, state: [draft, feedback], pos: [220, 0] }
  - { id: patch,  kind: agent, agent: patch-agent,  zone: refine, pos: [440, 0] }
  - { id: review, kind: agent, agent: review-agent, zone: refine, pos: [660, 0] }
  - { id: le,     kind: loop-end, zone: refine, until: '{review.output} contains "APPROVED"', maxIterations: 5, pos: [880, 0] }
  - { id: report, kind: agent, agent: normal-handler, pos: [1100, 0] }
edges:
  - { from: seed.output,   to: ls.draft }
  - { from: ls.draft,      to: patch.previous }
  - { from: ls.feedback,   to: patch.feedback }
  - { from: patch.output,  to: review.draft }
  - { from: patch.output,  to: le.draft }
  - { from: review.output, to: le.feedback }
  - { from: le.draft,      to: report.in }
---
```
> Reuses `normal-handler` from the 3a-1 example as the downstream `report`; if 3a-1's example isn't present, point `report` at any agent whose prompt uses `{in}`.

- [ ] **Step 3: Validate the chain**

Run:
```bash
npx tsx -e "import('./lib/fs/parseChain').then(m=>import('./lib/fs/parseAgent').then(a=>import('./lib/chainGraph').then(g=>{const c=m.parseChain('workspace/chains/refine-loop.md');console.log(JSON.stringify(g.validateChain(c,a.loadAllAgents('workspace')),null,2))})))"
```
Expected: `{ "valid": true, "errors": [] }`.

- [ ] **Step 4: Run end-to-end in the app**

Run `npm run dev`, open `/workspace?type=chain&slug=refine-loop`, enter a seed (e.g. "Write a one-paragraph product pitch for a note-taking app"), click **Run**.
Expected: patch and review alternate for up to 5 rounds, stopping when the review says APPROVED; the final draft reaches `report`. Open the run in `/history/<runId>` (Graph view): selecting `patch`/`review` shows each round in the preview.

- [ ] **Step 5: Commit**

```bash
git add workspace/agents/patch-agent.md workspace/agents/review-agent.md workspace/chains/refine-loop.md
git commit -m "chore: refine-loop example (patch <-> review loop zone)"
```

---

## Task 7: Final verification

- [ ] **Step 1: Run all loop + affected tests**

```bash
npx tsx tests/parse-loop.test.ts
npx tsx tests/resolve-loop.test.ts
npx tsx tests/validate-loop.test.ts
npx tsx tests/executor-loop.test.ts
npx tsx tests/executor-control.test.ts
npx tsx tests/executor.test.ts
npx tsx tests/chain-graph.test.ts
```
Expected: every file prints its `✅ ... passed` line.

- [ ] **Step 2: Type-check, lint, build**

Run: `npx tsc --noEmit` → no errors.
Run: `npm run lint` → no new errors in created/modified files.
Run: `npm run build` → succeeds.

- [ ] **Step 3: Regression check**

Confirm `story-chain` (plain) and `triage-demo` (gate/branch, from 3a-1) still run and render; LIST/COMPARE/EXPORT on the run page still work.

---

## Self-Review

**Spec coverage (slice 3a-2):**
- Loop kinds + `zone`/`state`/`until`/`maxIterations` types + parsing → Task 1. ✓
- Paired state sockets resolved on loop-start/loop-end → Task 2. ✓
- Zone well-formedness (one start/end, until, positive maxIterations, boundary rule) → Task 3. ✓
- Executor zone iteration with state carry, `round` tagging, exit on `until` or cap, final state downstream, zone-skip when blocked → Task 4. ✓
- Per-round trace preview → Task 5 (loop-node rendering reuses 3a-1's control labels). ✓
- `refine-loop` example end-to-end → Task 6. ✓

**Out of scope (noted):** gate/branch *inside* a loop body (body is agent/decider only); nested zones; map/foreach. The body loop in Task 4 only runs agent/decider members.

**Placeholder scan:** No TBD/TODO; full code in every code step; commands have expected output. UI/example tasks (5, 6) use manual verification, stated explicitly. ✓

**Type consistency:** `ChainNode.zone/state/until/maxIterations` and `AgentOutput.round` (Task 1) are consumed by `socketValue` (Task 2), `validateChain`/`validateZones` (Task 3), `runChainGraph` (Task 4), and the preview (Task 5). The `Zone` interface, `runAgentNode`, `edgeVal`, `setStateSockets`, `bodyOrder`, and `runZone` are all defined and used within Task 4. `controlOutput`/`markOut`/`incomingByNode`/`live`/`agentBySlug`/`nodeById` are reused from the 3a-1 executor. ✓
