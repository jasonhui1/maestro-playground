# Visual Chain Editor (Phase 4) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a Blender-style visual editor for chains — drag/wire/inline-edit nodes, autosave round-tripping to the chain `.md`, and run-in-editor with live previews streamed onto the nodes.

**Architecture:** A new interactive Graph view in the chain workspace page (Graph/YAML toggle). Almost all logic lives in pure, `tsx`-tested modules (`serializeChain`, `nodeSockets`, `editorOps`, `zoneFrames`, `runStream`, `runState`, plus a `validateChain` extension); React components under `components/editor/` stay thin. Persistence reuses the existing `useAutoSave` → `PUT /api/workspace/chain/[slug]` path; running reuses `POST /api/run` + SSE. No new server routes.

**Tech Stack:** Next.js 16 (App Router), React 19, TypeScript, `@xyflow/react` + `dagre`, `gray-matter`, `fuse.js`, `tsx` test runner.

## Global Constraints

- Next.js 16 with breaking changes from prior versions — consult `node_modules/next/dist/docs/` before touching App Router / API code; heed deprecation notices.
- Chains are filesystem-first `.md` files: everything lives in YAML frontmatter (`name`, `description`, `nodes`, `edges`); the body is empty.
- Edge endpoints in the file are strings `"node.socket"`, and a bare `"node"` means socket `output` (per `parseEndpoint` in `lib/fs/parseChain.ts`).
- Node `pos` is `[x, y]`. Output sockets are slugified names; `summary` counts only if declared in the agent's `outputs`.
- Tests: plain `node:assert` files, no framework, ending with `console.log('✅ <name> tests passed')`, run via `npx tsx tests/<file>`.
- Verification commands: `npx tsc --noEmit` (typecheck), `npm run lint`, `npm run build`.
- React components: `'use client'` where they use hooks/events; follow the Tailwind/zinc styling of `components/trace/TraceAgentNode.tsx`.
- The server (`/api/run`) re-validates with `validateChain` and remains the run gatekeeper; the client never hard-blocks Run.

---

### Task 1: `nodeSockets` — pure socket derivation

Single source of truth for "what input/output sockets does a node have," used by both the editor node components and `validateChain` (refactored to consume it, removing its private duplicates).

**Files:**
- Create: `lib/nodeSockets.ts`
- Modify: `lib/chainGraph.ts` (replace private `inputSlotsOf`/`outputSocketsOf` with imports)
- Test: `tests/node-sockets.test.ts`

**Interfaces:**
- Consumes: `ChainDef`, `ChainNode`, `AgentDef` from `lib/types`; `parseSlots` from `lib/slots`; `slugify` from `lib/graph`.
- Produces:
  - `inputSocketsOf(node: ChainNode, chain: ChainDef, agents: AgentDef[]): string[]`
  - `outputSocketsOf(node: ChainNode, chain: ChainDef, agents: AgentDef[]): string[]`

- [ ] **Step 1: Write the failing test**

Create `tests/node-sockets.test.ts`:

```ts
import assert from 'node:assert'
import { inputSocketsOf, outputSocketsOf } from '../lib/nodeSockets'
import { ChainDef, AgentDef } from '../lib/types'

function agent(slug: string, prompt: string, outputs = [{ name: 'output' }]): AgentDef {
  return { slug, name: slug, model: 'm', description: '', skills: [], context: [],
    input_from: 'user', output_format: 'markdown', outputs, inputs: [], systemPrompt: prompt, filePath: '' }
}
const agents = [agent('writer', 'Write {topic} for {audience}', [{ name: 'output' }, { name: 'Summary' }])]

const chain: ChainDef = {
  slug: 'c', name: 'c', description: '', filePath: '',
  nodes: [
    { id: 'seed', kind: 'seed' },
    { id: 'w', kind: 'agent', agent: 'writer' },
    { id: 'g', kind: 'gate', condition: 'x' },
    { id: 'b', kind: 'branch', cases: [{ label: 'urgent', condition: 'x' }], default: 'other' },
    { id: 'ls', kind: 'loop-start', zone: 'z1', state: ['draft'] },
    { id: 'le', kind: 'loop-end', zone: 'z1', until: 'x', maxIterations: 3 },
  ],
  edges: [],
}

// agent inputs = prompt slots; outputs = output + declared (slugified)
assert.deepStrictEqual(inputSocketsOf(chain.nodes[1], chain, agents), ['topic', 'audience'])
assert.deepStrictEqual(outputSocketsOf(chain.nodes[1], chain, agents), ['output', 'summary'])
// seed
assert.deepStrictEqual(inputSocketsOf(chain.nodes[0], chain, agents), [])
assert.deepStrictEqual(outputSocketsOf(chain.nodes[0], chain, agents), ['output'])
// gate
assert.deepStrictEqual(inputSocketsOf(chain.nodes[2], chain, agents), ['in'])
assert.deepStrictEqual(outputSocketsOf(chain.nodes[2], chain, agents), ['output'])
// branch outputs = case labels + default
assert.deepStrictEqual(outputSocketsOf(chain.nodes[3], chain, agents), ['urgent', 'other'])
// loop-end inherits state from its zone's loop-start
assert.deepStrictEqual(inputSocketsOf(chain.nodes[5], chain, agents), ['draft'])
assert.deepStrictEqual(outputSocketsOf(chain.nodes[5], chain, agents), ['draft'])

console.log('✅ node-sockets tests passed')
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx tsx tests/node-sockets.test.ts`
Expected: FAIL — `Cannot find module '../lib/nodeSockets'`.

- [ ] **Step 3: Write the implementation**

Create `lib/nodeSockets.ts`:

```ts
import { ChainDef, ChainNode, AgentDef } from './types'
import { parseSlots } from './slots'
import { slugify } from './graph'

function zoneStateOf(node: ChainNode, chain: ChainDef): string[] {
  if (!node.zone) return []
  const start = chain.nodes.find(n => n.kind === 'loop-start' && n.zone === node.zone)
  return start?.state ?? []
}

export function inputSocketsOf(node: ChainNode, chain: ChainDef, agents: AgentDef[]): string[] {
  if (node.kind === 'agent' || node.kind === 'decider') {
    const a = node.agent ? agents.find(x => x.slug === node.agent) : undefined
    return a ? parseSlots(a.systemPrompt) : []
  }
  if (node.kind === 'gate' || node.kind === 'branch') return ['in']
  if (node.kind === 'loop-start' || node.kind === 'loop-end') return zoneStateOf(node, chain)
  return []
}

export function outputSocketsOf(node: ChainNode, chain: ChainDef, agents: AgentDef[]): string[] {
  if (node.kind === 'seed' || node.kind === 'context') return ['output']
  if (node.kind === 'gate') return ['output']
  if (node.kind === 'branch') return [...(node.cases ?? []).map(c => c.label), ...(node.default ? [node.default] : [])]
  if (node.kind === 'loop-start' || node.kind === 'loop-end') return zoneStateOf(node, chain)
  const a = node.agent ? agents.find(x => x.slug === node.agent) : undefined
  return ['output', ...(a?.outputs ?? []).map(s => slugify(s.name))]
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx tsx tests/node-sockets.test.ts`
Expected: PASS — `✅ node-sockets tests passed`.

- [ ] **Step 5: Refactor `chainGraph` to consume `nodeSockets` (stay DRY)**

In `lib/chainGraph.ts`, add the import and replace the local derivation helpers. Add near the top imports:

```ts
import { inputSocketsOf, outputSocketsOf } from './nodeSockets'
```

Then delete the local `stateNamesByZone`/`zoneStateOf`/`inputSlotsOf`/`outputSocketsOf` definitions (the block at lines ~42–62) and update their call sites:
- replace `inputSlotsOf(dst)` with `inputSocketsOf(dst, chain, agents)`
- replace `outputSocketsOf(src)` with `outputSocketsOf(src, chain, agents)`

Leave `acceptsInputs` and everything else unchanged.

- [ ] **Step 6: Run the full existing suite to confirm no regression**

Run: `npx tsx tests/chain-graph.test.ts && npx tsx tests/validate-control.test.ts && npx tsx tests/validate-loop.test.ts`
Expected: all three print their `✅ … tests passed` lines.

- [ ] **Step 7: Commit**

```bash
git add lib/nodeSockets.ts lib/chainGraph.ts tests/node-sockets.test.ts
git commit -m "feat: extract pure nodeSockets socket derivation, reuse in validateChain"
```

---

### Task 2: `serializeChain` — graph → chain `.md`

The inverse of `parseChain`. The round-trip invariant is the safety net for all persistence.

**Files:**
- Create: `lib/serializeChain.ts`
- Test: `tests/serialize-chain.test.ts`

**Interfaces:**
- Consumes: `ChainNode`, `ChainEdge` from `lib/types`; `matter` from `gray-matter`; `parseChainContent` from `lib/fs/parseChain` (test only).
- Produces: `serializeChain(meta: { name: string; description?: string }, nodes: ChainNode[], edges: ChainEdge[]): string`

- [ ] **Step 1: Write the failing test**

Create `tests/serialize-chain.test.ts`:

```ts
import assert from 'node:assert'
import { serializeChain } from '../lib/serializeChain'
import { parseChainContent } from '../lib/fs/parseChain'

// Round-trip invariant: parse(serialize(parse(raw))) deep-equals parse(raw)
const raw = `---
name: triage-demo
description: demo
nodes:
  - { id: seed, kind: seed }
  - { id: t, kind: agent, agent: triage, pos: [250, 0] }
  - { id: b, kind: branch, cases: [{ label: urgent, condition: '{t.output} contains "URGENT"' }], default: other, pos: [500, 0] }
  - { id: ls, kind: loop-start, zone: z1, state: [draft], pos: [750, 0] }
  - { id: le, kind: loop-end, zone: z1, until: '{ls.draft} contains "DONE"', maxIterations: 3, pos: [1000, 0] }
edges:
  - { from: seed.output, to: t.input }
  - { from: t.output, to: b.in }
  - { from: b.urgent, to: ls.draft }
---
`
const c = parseChainContent(raw, 'triage-demo')
const out = serializeChain({ name: c.name, description: c.description }, c.nodes, c.edges)
const c2 = parseChainContent(out, 'triage-demo')
assert.deepStrictEqual(c2, c)

// Edge socket collapsing: output omitted, named sockets kept
assert.ok(/from: seed\n/.test(out) || /from: seed$/m.test(out), 'output socket should collapse to bare node')
assert.ok(/t\.input/.test(out), 'named input socket retained')

// Empty chain
const empty = serializeChain({ name: 'x', description: '' }, [], [])
const e2 = parseChainContent(empty, 'x')
assert.deepStrictEqual(e2.nodes, [])
assert.deepStrictEqual(e2.edges, [])

console.log('✅ serialize-chain tests passed')
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx tsx tests/serialize-chain.test.ts`
Expected: FAIL — `Cannot find module '../lib/serializeChain'`.

- [ ] **Step 3: Write the implementation**

Create `lib/serializeChain.ts`:

```ts
import matter from 'gray-matter'
import { ChainNode, ChainEdge } from './types'

function serializeNode(n: ChainNode): Record<string, unknown> {
  const out: Record<string, unknown> = { id: n.id, kind: n.kind }
  if (n.pos) out.pos = n.pos
  switch (n.kind) {
    case 'agent':
    case 'decider':
      if (n.agent !== undefined) out.agent = n.agent
      break
    case 'context':
      if (n.file !== undefined) out.file = n.file
      break
    case 'gate':
      if (n.condition !== undefined) out.condition = n.condition
      break
    case 'branch':
      if (n.cases) out.cases = n.cases.map(c => ({ label: c.label, condition: c.condition }))
      if (n.default !== undefined) out.default = n.default
      break
    case 'loop-start':
      if (n.zone !== undefined) out.zone = n.zone
      if (n.state) out.state = n.state
      break
    case 'loop-end':
      if (n.zone !== undefined) out.zone = n.zone
      if (n.until !== undefined) out.until = n.until
      if (n.maxIterations !== undefined) out.maxIterations = n.maxIterations
      break
  }
  return out
}

function serializeEdge(e: ChainEdge): { from: string; to: string } {
  const from = e.fromSocket === 'output' ? e.fromNode : `${e.fromNode}.${e.fromSocket}`
  const to = `${e.toNode}.${e.toSocket}`
  return { from, to }
}

export function serializeChain(
  meta: { name: string; description?: string },
  nodes: ChainNode[],
  edges: ChainEdge[],
): string {
  const data = {
    name: meta.name,
    description: meta.description ?? '',
    nodes: nodes.map(serializeNode),
    edges: edges.map(serializeEdge),
  }
  return matter.stringify('', data)
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx tsx tests/serialize-chain.test.ts`
Expected: PASS — `✅ serialize-chain tests passed`.

- [ ] **Step 5: Commit**

```bash
git add lib/serializeChain.ts tests/serialize-chain.test.ts
git commit -m "feat: add serializeChain (inverse of parseChain) with round-trip test"
```

---

### Task 3: `validateChain` structured issues

Add `issues: ValidationIssue[]` to the validator output so the editor can pin errors to nodes/edges/zones. Keep `errors: string[]` byte-identical so `/api/run` and existing tests are unaffected.

**Files:**
- Modify: `lib/types.ts` (add `ValidationIssue`, extend `ValidationResult`)
- Modify: `lib/chainGraph.ts` (thread an `add()` helper through every push site)
- Test: `tests/validate-issues.test.ts`

**Interfaces:**
- Produces: `ValidationIssue = { message: string; severity: 'error'; nodeId?: string; edge?: ChainEdge; zone?: string }`; `validateChain(...)` now returns `{ valid: boolean; errors: string[]; issues: ValidationIssue[] }`.

- [ ] **Step 1: Add the type (no test yet)**

In `lib/types.ts`, add after `ValidationResult`'s current definition — replace:

```ts
export interface ValidationResult {
  valid: boolean
  errors: string[]
}
```

with:

```ts
export interface ValidationIssue {
  message: string
  severity: 'error'
  nodeId?: string
  edge?: ChainEdge
  zone?: string
}

export interface ValidationResult {
  valid: boolean
  errors: string[]
  issues: ValidationIssue[]
}
```

- [ ] **Step 2: Write the failing test**

Create `tests/validate-issues.test.ts`:

```ts
import assert from 'node:assert'
import { validateChain } from '../lib/chainGraph'
import { ChainDef, AgentDef } from '../lib/types'

function agent(slug: string, prompt: string): AgentDef {
  return { slug, name: slug, model: 'm', description: '', skills: [], context: [],
    input_from: 'user', output_format: 'markdown', outputs: [{ name: 'output' }], inputs: [], systemPrompt: prompt, filePath: '' }
}
const agents = [agent('producer', 'Make: {input}'), agent('fast', 'Do: {in}')]

// gate without condition -> issue carries nodeId 'g'
const noCond: ChainDef = {
  slug: 'c', name: 'c', description: '', filePath: '',
  nodes: [
    { id: 'seed', kind: 'seed' },
    { id: 'p', kind: 'agent', agent: 'producer' },
    { id: 'g', kind: 'gate', condition: '' },
  ],
  edges: [
    { fromNode: 'seed', fromSocket: 'output', toNode: 'p', toSocket: 'input' },
    { fromNode: 'p', fromSocket: 'output', toNode: 'g', toSocket: 'in' },
  ],
}
const r = validateChain(noCond, agents)
assert.strictEqual(r.valid, false)
assert.ok(r.issues.some(i => i.nodeId === 'g' && /condition/i.test(i.message)))
// errors string list still populated (back-compat)
assert.ok(r.errors.some(e => /gate.*condition/i.test(e)))

// bad edge socket -> issue carries the edge
const badEdge: ChainDef = {
  slug: 'c', name: 'c', description: '', filePath: '',
  nodes: [{ id: 'seed', kind: 'seed' }, { id: 'p', kind: 'agent', agent: 'producer' }],
  edges: [{ fromNode: 'seed', fromSocket: 'nope', toNode: 'p', toSocket: 'input' }],
}
const r2 = validateChain(badEdge, agents)
assert.ok(r2.issues.some(i => i.edge && i.edge.fromSocket === 'nope'))

// malformed zone -> issue carries zone id
const badZone: ChainDef = {
  slug: 'c', name: 'c', description: '', filePath: '',
  nodes: [
    { id: 'seed', kind: 'seed' },
    { id: 'ls', kind: 'loop-start', zone: 'z1', state: [] },
    // no loop-end for z1
  ],
  edges: [],
}
const r3 = validateChain(badZone, agents)
assert.ok(r3.issues.some(i => i.zone === 'z1'))

console.log('✅ validate-issues tests passed')
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npx tsx tests/validate-issues.test.ts`
Expected: FAIL — `r.issues` is `undefined` (property does not exist).

- [ ] **Step 4: Thread an `add()` helper through `validateChain`**

In `lib/chainGraph.ts`, change the top of `validateChain` from:

```ts
export function validateChain(chain: ChainDef, agents: AgentDef[]): ValidationResult {
  const errors: string[] = []
```

to:

```ts
import { ValidationIssue } from './types'  // add to the existing import line if not present

export function validateChain(chain: ChainDef, agents: AgentDef[]): ValidationResult {
  const errors: string[] = []
  const issues: ValidationIssue[] = []
  const add = (message: string, ref: Omit<ValidationIssue, 'message' | 'severity'> = {}) => {
    errors.push(message)
    issues.push({ message, severity: 'error', ...ref })
  }
```

Then replace every `errors.push(...)` in `validateChain` and `validateZones` with `add(...)`, attaching the ref it already names in the message. Concretely:

- Duplicate/missing id checks → `add(msg, { nodeId: n.id })` (use the id when present).
- Per-node kind/agent/file/gate/branch checks → `add(msg, { nodeId: n.id })`.
- `checkRefs` pushes → give `checkRefs` an extra `nodeId` arg and call `add(msg, { nodeId })`.
- Edge checks (`Edge from unknown…`, `…no inputs`, `…no such output socket`, `…no such branch case`, `…no such input slot`) → `add(msg, { edge: e })`.
- Incoming-count check → `add(msg, { /* parse node from key */ nodeId: key.split('.')[0] })`.
- Cycle check → `add('Chain has a cycle')` (no ref).
- In `validateZones`, pass `add` in (change its signature to `validateZones(chain, add)`) and attach `{ zone: zid }` for zone messages and `{ edge: e }` for the boundary-crossing message.

Update `validateZones`' signature and the call site:

```ts
function validateZones(chain: ChainDef, add: (message: string, ref?: Omit<ValidationIssue, 'message' | 'severity'>) => void) {
```

```ts
  validateZones(chain, add)
  return { valid: errors.length === 0, errors, issues }
}
```

Update `checkRefs` to accept and forward a `nodeId`:

```ts
  const checkRefs = (label: string, expr: string | undefined, nodeId: string) => {
    if (!expr) return
    let m: RegExpExecArray | null
    refRe.lastIndex = 0
    while ((m = refRe.exec(expr)) !== null) {
      if (!nodeById.has(m[1])) add(`${label}: condition references unknown node "${m[1]}"`, { nodeId })
    }
  }
```
and at its call sites pass `n.id`.

- [ ] **Step 5: Run test to verify it passes**

Run: `npx tsx tests/validate-issues.test.ts`
Expected: PASS — `✅ validate-issues tests passed`.

- [ ] **Step 6: Confirm no regression in existing validator tests**

Run: `npx tsx tests/chain-graph.test.ts && npx tsx tests/validate-control.test.ts && npx tsx tests/validate-loop.test.ts`
Expected: all three print `✅ … tests passed`.

- [ ] **Step 7: Commit**

```bash
git add lib/types.ts lib/chainGraph.ts tests/validate-issues.test.ts
git commit -m "feat: validateChain returns structured issues (nodeId/edge/zone)"
```

---

### Task 4: `editorOps` — pure graph mutations

The editor's mutation core: id generation, add/connect/delete, and loop-zone creation. Pure functions over `{nodes, edges}` so the React layer stays trivial.

**Files:**
- Create: `lib/editorOps.ts`
- Test: `tests/editor-ops.test.ts`

**Interfaces:**
- Consumes: `ChainNode`, `ChainEdge`, `ChainNodeKind` from `lib/types`.
- Produces:
  - `uniqueNodeId(kind: string, existing: string[]): string`
  - `connectEdge(edges: ChainEdge[], edge: ChainEdge): ChainEdge[]` (replaces any edge into the same `toNode.toSocket`)
  - `deleteNode(nodes: ChainNode[], edges: ChainEdge[], id: string): { nodes: ChainNode[]; edges: ChainEdge[] }`
  - `deleteEdge(edges: ChainEdge[], edge: ChainEdge): ChainEdge[]`
  - `makeLoopZone(existingIds: string[], pos: [number, number]): ChainNode[]`

- [ ] **Step 1: Write the failing test**

Create `tests/editor-ops.test.ts`:

```ts
import assert from 'node:assert'
import { uniqueNodeId, connectEdge, deleteNode, deleteEdge, makeLoopZone } from '../lib/editorOps'
import { ChainEdge } from '../lib/types'

// uniqueNodeId increments until free
assert.strictEqual(uniqueNodeId('agent', []), 'agent-1')
assert.strictEqual(uniqueNodeId('agent', ['agent-1', 'agent-2']), 'agent-3')

// connectEdge replaces an existing edge into the same input socket
const e1: ChainEdge = { fromNode: 'a', fromSocket: 'output', toNode: 'c', toSocket: 'input' }
const e2: ChainEdge = { fromNode: 'b', fromSocket: 'output', toNode: 'c', toSocket: 'input' }
const after = connectEdge([e1], e2)
assert.strictEqual(after.length, 1)
assert.deepStrictEqual(after[0], e2)

// connectEdge keeps edges into a different socket
const e3: ChainEdge = { fromNode: 'b', fromSocket: 'output', toNode: 'c', toSocket: 'other' }
assert.strictEqual(connectEdge([e1], e3).length, 2)

// deleteNode removes the node and all incident edges
const del = deleteNode(
  [{ id: 'a', kind: 'seed' }, { id: 'c', kind: 'agent', agent: 'x' }],
  [e1],
  'c',
)
assert.strictEqual(del.nodes.length, 1)
assert.strictEqual(del.edges.length, 0)

// deleteEdge removes only the exact edge
assert.strictEqual(deleteEdge([e1, e3], e1).length, 1)

// makeLoopZone creates a paired start/end sharing one zone id, unique ids
const pair = makeLoopZone([], [100, 200])
assert.strictEqual(pair.length, 2)
assert.strictEqual(pair[0].kind, 'loop-start')
assert.strictEqual(pair[1].kind, 'loop-end')
assert.strictEqual(pair[0].zone, pair[1].zone)
assert.notStrictEqual(pair[0].id, pair[1].id)
assert.deepStrictEqual(pair[0].pos, [100, 200])

console.log('✅ editor-ops tests passed')
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx tsx tests/editor-ops.test.ts`
Expected: FAIL — `Cannot find module '../lib/editorOps'`.

- [ ] **Step 3: Write the implementation**

Create `lib/editorOps.ts`:

```ts
import { ChainNode, ChainEdge } from './types'

export function uniqueNodeId(kind: string, existing: string[]): string {
  const set = new Set(existing)
  let i = 1
  while (set.has(`${kind}-${i}`)) i++
  return `${kind}-${i}`
}

export function connectEdge(edges: ChainEdge[], edge: ChainEdge): ChainEdge[] {
  const kept = edges.filter(e => !(e.toNode === edge.toNode && e.toSocket === edge.toSocket))
  return [...kept, edge]
}

export function deleteNode(
  nodes: ChainNode[],
  edges: ChainEdge[],
  id: string,
): { nodes: ChainNode[]; edges: ChainEdge[] } {
  return {
    nodes: nodes.filter(n => n.id !== id),
    edges: edges.filter(e => e.fromNode !== id && e.toNode !== id),
  }
}

export function deleteEdge(edges: ChainEdge[], edge: ChainEdge): ChainEdge[] {
  return edges.filter(
    e => !(e.fromNode === edge.fromNode && e.fromSocket === edge.fromSocket &&
           e.toNode === edge.toNode && e.toSocket === edge.toSocket),
  )
}

export function makeLoopZone(existingIds: string[], pos: [number, number]): ChainNode[] {
  const zone = uniqueNodeId('zone', existingIds)
  const startId = uniqueNodeId('loop-start', existingIds)
  const endId = uniqueNodeId('loop-end', [...existingIds, startId])
  return [
    { id: startId, kind: 'loop-start', zone, state: [], pos },
    { id: endId, kind: 'loop-end', zone, until: '', maxIterations: 3, pos: [pos[0] + 360, pos[1]] },
  ]
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx tsx tests/editor-ops.test.ts`
Expected: PASS — `✅ editor-ops tests passed`.

- [ ] **Step 5: Commit**

```bash
git add lib/editorOps.ts tests/editor-ops.test.ts
git commit -m "feat: add pure editorOps (id/connect/delete/loop-zone) for the chain editor"
```

---

### Task 5: `zoneFrames` — bounding boxes for loop zones

Pure computation of the rectangle behind each zone's members, recomputed from node positions.

**Files:**
- Create: `lib/zoneFrames.ts`
- Test: `tests/zone-frames.test.ts`

**Interfaces:**
- Consumes: `ChainNode` from `lib/types`.
- Produces: `ZoneFrameBox = { zone: string; x: number; y: number; width: number; height: number }`; `computeZoneFrames(nodes: ChainNode[]): ZoneFrameBox[]`. Constants `NODE_W = 240`, `NODE_H = 120`, `PAD = 32` (exported for the renderer to align).

- [ ] **Step 1: Write the failing test**

Create `tests/zone-frames.test.ts`:

```ts
import assert from 'node:assert'
import { computeZoneFrames, PAD, NODE_W, NODE_H } from '../lib/zoneFrames'
import { ChainNode } from '../lib/types'

const nodes: ChainNode[] = [
  { id: 'ls', kind: 'loop-start', zone: 'z1', state: [], pos: [100, 100] },
  { id: 'mid', kind: 'agent', agent: 'x', zone: 'z1', pos: [300, 180] },
  { id: 'le', kind: 'loop-end', zone: 'z1', until: 'x', maxIterations: 2, pos: [500, 100] },
  { id: 'free', kind: 'seed', pos: [0, 0] }, // no zone -> ignored
]

const frames = computeZoneFrames(nodes)
assert.strictEqual(frames.length, 1)
const f = frames[0]
assert.strictEqual(f.zone, 'z1')
// minX=100, maxX=500+NODE_W ; box padded by PAD
assert.strictEqual(f.x, 100 - PAD)
assert.strictEqual(f.y, 100 - PAD)
assert.strictEqual(f.width, (500 + NODE_W - 100) + 2 * PAD)
assert.strictEqual(f.height, (180 + NODE_H - 100) + 2 * PAD)

// nodes without pos are ignored
assert.deepStrictEqual(computeZoneFrames([{ id: 'a', kind: 'loop-start', zone: 'z9', state: [] }]), [])

console.log('✅ zone-frames tests passed')
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx tsx tests/zone-frames.test.ts`
Expected: FAIL — `Cannot find module '../lib/zoneFrames'`.

- [ ] **Step 3: Write the implementation**

Create `lib/zoneFrames.ts`:

```ts
import { ChainNode } from './types'

export const NODE_W = 240
export const NODE_H = 120
export const PAD = 32

export interface ZoneFrameBox {
  zone: string
  x: number
  y: number
  width: number
  height: number
}

export function computeZoneFrames(nodes: ChainNode[]): ZoneFrameBox[] {
  const byZone = new Map<string, ChainNode[]>()
  for (const n of nodes) {
    if (!n.zone || !n.pos) continue
    const arr = byZone.get(n.zone) ?? []
    arr.push(n)
    byZone.set(n.zone, arr)
  }
  const frames: ZoneFrameBox[] = []
  for (const [zone, members] of byZone) {
    const xs = members.map(m => m.pos![0])
    const ys = members.map(m => m.pos![1])
    const minX = Math.min(...xs)
    const minY = Math.min(...ys)
    const maxX = Math.max(...xs) + NODE_W
    const maxY = Math.max(...ys) + NODE_H
    frames.push({ zone, x: minX - PAD, y: minY - PAD, width: maxX - minX + 2 * PAD, height: maxY - minY + 2 * PAD })
  }
  return frames
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx tsx tests/zone-frames.test.ts`
Expected: PASS — `✅ zone-frames tests passed`.

- [ ] **Step 5: Commit**

```bash
git add lib/zoneFrames.ts tests/zone-frames.test.ts
git commit -m "feat: add computeZoneFrames for loop-zone bounding boxes"
```

---

### Task 6: `runStream` — shared SSE parser + console adoption

Extract the SSE read/parse loop currently inline in `app/workspace/page.tsx` so the console and the editor share one parser, then make the console use it.

**Files:**
- Create: `lib/runStream.ts`
- Modify: `app/workspace/page.tsx` (replace the manual loop in `runSingleInstance`)
- Test: `tests/run-stream.test.ts`

**Interfaces:**
- Consumes: `AgentOutput` from `lib/types`.
- Produces:
  - `type RunEvent` (discriminated union: `agent_start | token | agent_done | run_complete | error`)
  - `streamRun(reader: ReadableStreamDefaultReader<Uint8Array>, onEvent: (e: RunEvent) => void): Promise<void>`

- [ ] **Step 1: Write the failing test**

Create `tests/run-stream.test.ts`:

```ts
import assert from 'node:assert'
import { streamRun, RunEvent } from '../lib/runStream'

function streamFromChunks(chunks: string[]): ReadableStreamDefaultReader<Uint8Array> {
  const enc = new TextEncoder()
  return new ReadableStream<Uint8Array>({
    start(controller) {
      for (const c of chunks) controller.enqueue(enc.encode(c))
      controller.close()
    },
  }).getReader()
}

const events: RunEvent[] = []
// a frame deliberately split across two chunks
const reader = streamFromChunks([
  'data: {"type":"agent_start","nodeId":"a","agentName":"writer","step":0}\n\n',
  'data: {"type":"tok',
  'en","nodeId":"a","token":"hi","step":0}\n\ndata: {"type":"agent_done","nodeId":"a","agentName":"writer","step":0,"output":{"output":"hi there"}}\n\n',
  'data: {"type":"run_complete","runId":"r1"}\n\n',
])

await streamRun(reader, e => events.push(e))

assert.deepStrictEqual(events.map(e => e.type), ['agent_start', 'token', 'agent_done', 'run_complete'])
assert.strictEqual((events[1] as Extract<RunEvent, { type: 'token' }>).token, 'hi')
assert.strictEqual((events[3] as Extract<RunEvent, { type: 'run_complete' }>).runId, 'r1')

console.log('✅ run-stream tests passed')
```

(The test file uses top-level `await`; `tsx` runs it as an ES module so this is supported.)

- [ ] **Step 2: Run test to verify it fails**

Run: `npx tsx tests/run-stream.test.ts`
Expected: FAIL — `Cannot find module '../lib/runStream'`.

- [ ] **Step 3: Write the implementation**

Create `lib/runStream.ts`:

```ts
import { AgentOutput } from './types'

export type RunEvent =
  | { type: 'agent_start'; nodeId: string; agentName: string; step: number }
  | { type: 'token'; nodeId: string; agentName?: string; token: string; tokenType?: string; step?: number }
  | { type: 'agent_done'; nodeId: string; agentName: string; step: number; output: AgentOutput }
  | { type: 'run_complete'; runId: string }
  | { type: 'error'; error: string }

export async function streamRun(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  onEvent: (e: RunEvent) => void,
): Promise<void> {
  const decoder = new TextDecoder()
  let buffer = ''
  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })
    const frames = buffer.split('\n\n')
    buffer = frames.pop() ?? ''
    for (const frame of frames) {
      const line = frame.split('\n').find(l => l.startsWith('data: '))
      if (!line) continue
      try {
        onEvent(JSON.parse(line.slice(6)) as RunEvent)
      } catch {
        // ignore malformed frame
      }
    }
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx tsx tests/run-stream.test.ts`
Expected: PASS — `✅ run-stream tests passed`.

- [ ] **Step 5: Make the console use `streamRun`**

In `app/workspace/page.tsx`, add the import:

```ts
import { streamRun, RunEvent } from '@/lib/runStream';
```

Replace the body of `runSingleInstance` from the `const reader = …` line through the end of the manual `while (true) { … }` loop with:

```ts
      const reader = response.body?.getReader();
      if (!reader) return;

      await streamRun(reader, (data: RunEvent) => {
        if (data.type === 'agent_start') {
          setRunsByFile(prev => {
            const fileRuns = prev[currentFileKey] || [];
            return {
              ...prev,
              [currentFileKey]: fileRuns.map(r => r.id === runId ? {
                ...r,
                instances: [...r.instances, {
                  runIndex,
                  agentName: data.agentName,
                  step: data.step || 0,
                  output: '',
                  isStreaming: true,
                }]
              } : r)
            };
          });
        } else if (data.type === 'token') {
          setRunsByFile(prev => {
            const fileRuns = prev[currentFileKey] || [];
            return {
              ...prev,
              [currentFileKey]: fileRuns.map(r => r.id === runId ? {
                ...r,
                instances: r.instances.map(a => {
                  if (a.runIndex === runIndex && a.agentName === data.agentName && (a.step === data.step || data.step === undefined)) {
                    if (data.tokenType === 'thought') {
                      return { ...a, thought: (a.thought || '') + data.token };
                    }
                    return { ...a, output: a.output + data.token };
                  }
                  return a;
                })
              } : r)
            };
          });
        } else if (data.type === 'agent_done') {
          const o: AgentOutput = data.output;
          setRunsByFile(prev => {
            const fileRuns = prev[currentFileKey] || [];
            return {
              ...prev,
              [currentFileKey]: fileRuns.map(r => r.id === runId ? {
                ...r,
                instances: r.instances.map(a =>
                  a.runIndex === runIndex && a.agentName === data.agentName && (a.step === data.step || data.step === undefined)
                    ? { ...a, isStreaming: false, ...o }
                    : a
                )
              } : r)
            };
          });
        } else if (data.type === 'error') {
          setRunsByFile(prev => {
            const fileRuns = prev[currentFileKey] || [];
            return {
              ...prev,
              [currentFileKey]: fileRuns.map(r => r.id === runId ? {
                ...r,
                status: 'error',
                instances: [...r.instances, {
                  runIndex,
                  agentName: 'System',
                  step: -1,
                  output: '',
                  isStreaming: false,
                  status: 'error',
                  error: data.error
                }]
              } : r)
            };
          });
        }
      });
```

(The `token` branch references `data.agentName`, which `RunEvent`'s token variant includes as optional — matching the SSE payload from `app/api/run/route.ts`.)

- [ ] **Step 6: Typecheck + lint + manual smoke**

Run: `npx tsc --noEmit && npm run lint`
Expected: no errors.

Manual smoke: `npm run dev`, open a chain or agent in the workspace, click **Run**, confirm tokens still stream into the Output Console exactly as before.

- [ ] **Step 7: Commit**

```bash
git add lib/runStream.ts app/workspace/page.tsx tests/run-stream.test.ts
git commit -m "refactor: extract streamRun SSE parser, adopt it in the workspace console"
```

---

### Task 7: `runState` — pure live-preview reducer

Convert run events into per-node display state, so the editor's live preview is a tested pure reducer rather than ad-hoc component state.

**Files:**
- Create: `lib/runState.ts`
- Test: `tests/run-state.test.ts`

**Interfaces:**
- Consumes: `RunEvent` from `lib/runStream`.
- Produces:
  - `NodeRunState = { status: 'idle' | 'running' | 'success' | 'error' | 'skipped'; output: string; thought: string; rounds: { round: number; output: string }[]; agentName?: string }`
  - `RunStateMap = Record<string, NodeRunState>`
  - `applyRunEvent(state: RunStateMap, e: RunEvent): RunStateMap`

- [ ] **Step 1: Write the failing test**

Create `tests/run-state.test.ts`:

```ts
import assert from 'node:assert'
import { applyRunEvent, RunStateMap } from '../lib/runState'
import { RunEvent } from '../lib/runStream'

function out(overrides: Partial<{ output: string; status: string; round: number; agentName: string }>) {
  return { agentName: 'w', systemPrompt: '', input: '', output: '', thought: '', tokensIn: 0, tokensOut: 0,
    costUsd: 0, latencyMs: 0, model: 'm', timestamp: '', status: 'success', ...overrides } as any
}

let s: RunStateMap = {}
s = applyRunEvent(s, { type: 'agent_start', nodeId: 'a', agentName: 'w', step: 0 })
assert.strictEqual(s.a.status, 'running')

s = applyRunEvent(s, { type: 'token', nodeId: 'a', token: 'he', step: 0 })
s = applyRunEvent(s, { type: 'token', nodeId: 'a', token: 'llo', step: 0 })
assert.strictEqual(s.a.output, 'hello')

s = applyRunEvent(s, { type: 'agent_done', nodeId: 'a', agentName: 'w', step: 0, output: out({ output: 'hello', status: 'success' }) })
assert.strictEqual(s.a.status, 'success')
assert.strictEqual(s.a.output, 'hello')

// thought tokens accumulate separately
s = applyRunEvent(s, { type: 'token', nodeId: 'a', token: 'hmm', tokenType: 'thought', step: 0 })
assert.strictEqual(s.a.thought, 'hmm')

// looped node: agent_done with round archives into rounds, resets buffer on next start
let l: RunStateMap = {}
l = applyRunEvent(l, { type: 'agent_start', nodeId: 'p', agentName: 'patch', step: 1 })
l = applyRunEvent(l, { type: 'agent_done', nodeId: 'p', agentName: 'patch', step: 1, output: out({ output: 'v1', round: 0 }) })
l = applyRunEvent(l, { type: 'agent_start', nodeId: 'p', agentName: 'patch', step: 2 })
l = applyRunEvent(l, { type: 'agent_done', nodeId: 'p', agentName: 'patch', step: 2, output: out({ output: 'v2', round: 1 }) })
assert.deepStrictEqual(l.p.rounds, [{ round: 0, output: 'v1' }, { round: 1, output: 'v2' }])
assert.strictEqual(l.p.output, 'v2')

// skipped status carried through
let k: RunStateMap = {}
k = applyRunEvent(k, { type: 'agent_done', nodeId: 'z', agentName: 'z', step: 5, output: out({ output: '', status: 'skipped' }) })
assert.strictEqual(k.z.status, 'skipped')

console.log('✅ run-state tests passed')
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx tsx tests/run-state.test.ts`
Expected: FAIL — `Cannot find module '../lib/runState'`.

- [ ] **Step 3: Write the implementation**

Create `lib/runState.ts`:

```ts
import { RunEvent } from './runStream'

export interface NodeRunState {
  status: 'idle' | 'running' | 'success' | 'error' | 'skipped'
  output: string
  thought: string
  rounds: { round: number; output: string }[]
  agentName?: string
}

export type RunStateMap = Record<string, NodeRunState>

const empty = (): NodeRunState => ({ status: 'idle', output: '', thought: '', rounds: [] })

export function applyRunEvent(state: RunStateMap, e: RunEvent): RunStateMap {
  if (e.type === 'agent_start') {
    const prev = state[e.nodeId] ?? empty()
    return { ...state, [e.nodeId]: { ...prev, status: 'running', output: '', thought: '', agentName: e.agentName } }
  }
  if (e.type === 'token') {
    const prev = state[e.nodeId] ?? empty()
    const next = e.tokenType === 'thought'
      ? { ...prev, thought: prev.thought + e.token }
      : { ...prev, output: prev.output + e.token }
    return { ...state, [e.nodeId]: next }
  }
  if (e.type === 'agent_done') {
    const prev = state[e.nodeId] ?? empty()
    const status = (e.output.status as NodeRunState['status']) ?? 'success'
    const rounds = e.output.round !== undefined
      ? [...prev.rounds, { round: e.output.round, output: e.output.output }]
      : prev.rounds
    return { ...state, [e.nodeId]: { ...prev, status, output: e.output.output, agentName: e.output.agentName, rounds } }
  }
  return state
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx tsx tests/run-state.test.ts`
Expected: PASS — `✅ run-state tests passed`.

- [ ] **Step 5: Commit**

```bash
git add lib/runState.ts tests/run-state.test.ts
git commit -m "feat: add applyRunEvent reducer for per-node live preview state"
```

---

### Task 8: `useAutoSave.flush()` for save-then-run

Add a `flush()` that cancels the pending debounce and persists immediately, supporting an optional content override (so the editor can pass freshly-serialized markdown without waiting for a React state tick).

**Files:**
- Modify: `hooks/useAutoSave.ts`

**Interfaces:**
- Produces: `useAutoSave(...)` return value gains `flush: (override?: string) => Promise<void>`.

- [ ] **Step 1: Add `flush` to the hook**

In `hooks/useAutoSave.ts`, add this `flush` callback after the `save` callback definition (after the `useCallback` that ends at line ~79):

```ts
  const flush = useCallback(async (override?: string) => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    const target = override ?? content;
    if (target !== lastSavedContentRef.current) {
      await save(target);
    }
  }, [content, save]);
```

Then extend the return object:

```ts
  return {
    content,
    setContent,
    status,
    error,
    isDirty,
    flush,
  };
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors (existing consumers ignore the new field).

- [ ] **Step 3: Manual smoke (regression)**

`npm run dev`, edit a file in the workspace, confirm autosave still fires after ~2s (status shows "saved").

- [ ] **Step 4: Commit**

```bash
git add hooks/useAutoSave.ts
git commit -m "feat: add flush(override?) to useAutoSave for save-then-run"
```

---

### Task 9: Editor node components — sources & agents

Editable, Blender-style node bodies for `seed`, `context`, `agent`, `decider`. Handles are derived from `nodeSockets`. Each node receives a typed `data` object including callbacks to mutate itself.

**Files:**
- Create: `components/editor/nodeData.ts` (shared data type + helpers)
- Create: `components/editor/nodes/SeedNode.tsx`
- Create: `components/editor/nodes/ContextNode.tsx`
- Create: `components/editor/nodes/AgentNode.tsx` (also used for `decider`)

**Interfaces:**
- Consumes: `inputSocketsOf`/`outputSocketsOf` (Task 1); `NodeRunState` (Task 7); `@xyflow/react` `Handle`/`Position`/`NodeProps`.
- Produces: `EditorNodeData` type:

```ts
export interface EditorNodeData {
  node: ChainNode
  inputs: string[]
  outputs: string[]
  agents: { slug: string; name: string }[]
  contextFiles: { slug: string; name: string }[]
  run?: NodeRunState
  issues: string[]
  onChange: (patch: Partial<ChainNode>) => void
}
```

- [ ] **Step 1: Create the shared data type**

Create `components/editor/nodeData.ts`:

```ts
import { ChainNode } from '@/lib/types'
import { NodeRunState } from '@/lib/runState'

export interface EditorNodeData {
  node: ChainNode
  inputs: string[]
  outputs: string[]
  agents: { slug: string; name: string }[]
  contextFiles: { slug: string; name: string }[]
  run?: NodeRunState
  issues: string[]
  onChange: (patch: Partial<ChainNode>) => void
  [key: string]: unknown
}

export function statusDotClass(run?: NodeRunState): string {
  if (!run || run.status === 'idle') return 'bg-zinc-300'
  if (run.status === 'running') return 'bg-blue-500 animate-pulse'
  if (run.status === 'error') return 'bg-red-500'
  if (run.status === 'skipped') return 'bg-zinc-300'
  return 'bg-green-500'
}
```

- [ ] **Step 2: Create `SeedNode`**

Create `components/editor/nodes/SeedNode.tsx`:

```tsx
'use client'
import React, { memo } from 'react'
import { Handle, Position, type NodeProps, type Node } from '@xyflow/react'
import type { EditorNodeData } from '../nodeData'

function SeedNode({ data }: NodeProps<Node<EditorNodeData>>) {
  return (
    <div className="relative rounded-lg shadow-md border-2 border-zinc-200 bg-white min-w-[160px]">
      <div className="px-4 py-2 border-b border-zinc-100 bg-zinc-50/50 rounded-t-lg">
        <span className="text-[9px] font-bold text-zinc-400 uppercase tracking-widest">Seed</span>
        <div className="text-xs font-bold text-zinc-900">{data.node.id}</div>
      </div>
      <div className="px-4 py-2 flex justify-end text-[9px] font-mono text-zinc-400">
        <div className="relative pr-3 flex items-center justify-end h-5">
          <span>.output</span>
          <Handle type="source" id="output" position={Position.Right}
            style={{ right: -16, top: '50%', transform: 'translateY(-50%)' }}
            className="w-2.5 h-2.5 border-2 border-white !bg-zinc-900" />
        </div>
      </div>
    </div>
  )
}
export default memo(SeedNode)
```

- [ ] **Step 3: Create `ContextNode`**

Create `components/editor/nodes/ContextNode.tsx`:

```tsx
'use client'
import React, { memo } from 'react'
import { Handle, Position, type NodeProps, type Node } from '@xyflow/react'
import type { EditorNodeData } from '../nodeData'

function ContextNode({ data }: NodeProps<Node<EditorNodeData>>) {
  return (
    <div className="relative rounded-lg shadow-md border-2 border-zinc-200 bg-white min-w-[200px]">
      <div className="px-4 py-2 border-b border-zinc-100 bg-zinc-50/50 rounded-t-lg">
        <span className="text-[9px] font-bold text-zinc-400 uppercase tracking-widest">Context</span>
        <div className="text-xs font-bold text-zinc-900">{data.node.id}</div>
      </div>
      <div className="px-4 py-2 space-y-2">
        <select
          value={data.node.file ?? ''}
          onChange={e => data.onChange({ file: e.target.value })}
          className="w-full text-xs border border-zinc-200 rounded px-2 py-1 nodrag"
        >
          <option value="">— pick a context file —</option>
          {data.contextFiles.map(f => <option key={f.slug} value={f.slug}>{f.name}</option>)}
        </select>
        <div className="flex justify-end text-[9px] font-mono text-zinc-400">
          <div className="relative pr-3 flex items-center justify-end h-5">
            <span>.output</span>
            <Handle type="source" id="output" position={Position.Right}
              style={{ right: -16, top: '50%', transform: 'translateY(-50%)' }}
              className="w-2.5 h-2.5 border-2 border-white !bg-zinc-900" />
          </div>
        </div>
      </div>
    </div>
  )
}
export default memo(ContextNode)
```

(The `nodrag` class tells React Flow not to start a node drag when interacting with the control.)

- [ ] **Step 4: Create `AgentNode` (agent + decider)**

Create `components/editor/nodes/AgentNode.tsx`:

```tsx
'use client'
import React, { memo } from 'react'
import { Handle, Position, type NodeProps, type Node } from '@xyflow/react'
import type { EditorNodeData } from '../nodeData'
import { statusDotClass } from '../nodeData'

function AgentNode({ data, selected }: NodeProps<Node<EditorNodeData>>) {
  const { node, inputs, outputs, run, issues } = data
  const kindLabel = node.kind === 'decider' ? 'Decider' : 'Agent'
  return (
    <div className={`relative rounded-lg shadow-md border-2 min-w-[240px] bg-white ${run?.status === 'skipped' ? 'opacity-60' : ''} ${issues.length ? 'border-red-400' : selected ? 'border-zinc-900 ring-4 ring-zinc-900/5' : 'border-zinc-200'}`}>
      <div className="px-4 py-2 border-b border-zinc-100 bg-zinc-50/50 rounded-t-lg">
        <div className="flex items-center gap-2 mb-0.5">
          <div className={`w-2 h-2 rounded-full ${statusDotClass(run)}`} />
          <span className="text-[9px] font-bold text-zinc-400 uppercase tracking-widest">{kindLabel}</span>
          {issues.length > 0 && <span className="ml-auto text-[9px] font-bold text-red-500">{issues.length}!</span>}
        </div>
        <div className="text-xs font-bold text-zinc-900">{node.id}</div>
      </div>

      <div className="px-4 py-2">
        <select
          value={node.agent ?? ''}
          onChange={e => data.onChange({ agent: e.target.value })}
          className="w-full text-xs border border-zinc-200 rounded px-2 py-1 nodrag mb-2"
        >
          <option value="">— pick an agent —</option>
          {data.agents.map(a => <option key={a.slug} value={a.slug}>{a.name}</option>)}
        </select>

        <div className="flex justify-between gap-4 text-[9px] font-mono text-zinc-400">
          <div className="flex flex-col gap-1.5">
            {inputs.map(s => (
              <div key={s} className="relative pl-3 flex items-center h-5">
                <Handle type="target" id={s} position={Position.Left}
                  style={{ left: -16, top: '50%', transform: 'translateY(-50%)' }}
                  className="w-2.5 h-2.5 border-2 border-white !bg-zinc-400" />
                <span className="truncate max-w-[100px]" title={s}>{s}</span>
              </div>
            ))}
          </div>
          <div className="flex flex-col gap-1.5 text-right">
            {outputs.map(s => (
              <div key={s} className="relative pr-3 flex items-center justify-end h-5">
                <span className="truncate max-w-[100px]" title={`.${s}`}>.{s}</span>
                <Handle type="source" id={s} position={Position.Right}
                  style={{ right: -16, top: '50%', transform: 'translateY(-50%)' }}
                  className="w-2.5 h-2.5 border-2 border-white !bg-zinc-900" />
              </div>
            ))}
          </div>
        </div>

        {run && run.output && (
          <div className="mt-2 text-[10px] text-zinc-600 bg-zinc-50 border border-zinc-100 rounded p-2 max-h-24 overflow-hidden whitespace-pre-wrap">
            {run.output.slice(0, 240)}
          </div>
        )}
      </div>
    </div>
  )
}
export default memo(AgentNode)
```

- [ ] **Step 5: Typecheck + lint**

Run: `npx tsc --noEmit && npm run lint`
Expected: no errors. (Components are not yet mounted anywhere; this only checks they compile.)

- [ ] **Step 6: Commit**

```bash
git add components/editor/nodeData.ts components/editor/nodes/SeedNode.tsx components/editor/nodes/ContextNode.tsx components/editor/nodes/AgentNode.tsx
git commit -m "feat: add editor node components for seed/context/agent/decider"
```

---

### Task 10: Editor node components — control & loop

Editable bodies for `gate`, `branch`, `loop-start`, `loop-end`, including the inline branch case list and the loop `state`/`until`/`maxIterations` fields.

**Files:**
- Create: `components/editor/nodes/GateNode.tsx`
- Create: `components/editor/nodes/BranchNode.tsx`
- Create: `components/editor/nodes/LoopStartNode.tsx`
- Create: `components/editor/nodes/LoopEndNode.tsx`

**Interfaces:**
- Consumes: `EditorNodeData` (Task 9); `BranchCase` from `lib/types`; `@xyflow/react` handles.
- Produces: four default-exported memoized components.

- [ ] **Step 1: Create `GateNode`**

Create `components/editor/nodes/GateNode.tsx`:

```tsx
'use client'
import React, { memo } from 'react'
import { Handle, Position, type NodeProps, type Node } from '@xyflow/react'
import type { EditorNodeData } from '../nodeData'
import { statusDotClass } from '../nodeData'

function GateNode({ data, selected }: NodeProps<Node<EditorNodeData>>) {
  const { node, run, issues } = data
  return (
    <div className={`relative rounded-lg shadow-md border-2 min-w-[220px] bg-white ${issues.length ? 'border-red-400' : selected ? 'border-zinc-900 ring-4 ring-zinc-900/5' : 'border-zinc-200'}`}>
      <div className="px-4 py-2 border-b border-zinc-100 bg-zinc-50/50 rounded-t-lg flex items-center gap-2">
        <div className={`w-2 h-2 rounded-full ${statusDotClass(run)}`} />
        <span className="text-[9px] font-bold text-zinc-400 uppercase tracking-widest">Gate</span>
        <span className="text-xs font-bold text-zinc-900 ml-1">{node.id}</span>
      </div>
      <div className="px-4 py-2">
        <input
          value={node.condition ?? ''}
          onChange={e => data.onChange({ condition: e.target.value })}
          placeholder='e.g. {x.output} contains "OK"'
          className="w-full text-[11px] font-mono border border-zinc-200 rounded px-2 py-1 nodrag mb-2"
        />
        <div className="flex justify-between text-[9px] font-mono text-zinc-400">
          <div className="relative pl-3 flex items-center h-5">
            <Handle type="target" id="in" position={Position.Left}
              style={{ left: -16, top: '50%', transform: 'translateY(-50%)' }}
              className="w-2.5 h-2.5 border-2 border-white !bg-zinc-400" />
            <span>in</span>
          </div>
          <div className="relative pr-3 flex items-center justify-end h-5">
            <span>.output</span>
            <Handle type="source" id="output" position={Position.Right}
              style={{ right: -16, top: '50%', transform: 'translateY(-50%)' }}
              className="w-2.5 h-2.5 border-2 border-white !bg-zinc-900" />
          </div>
        </div>
      </div>
    </div>
  )
}
export default memo(GateNode)
```

- [ ] **Step 2: Create `BranchNode`**

Create `components/editor/nodes/BranchNode.tsx`:

```tsx
'use client'
import React, { memo } from 'react'
import { Handle, Position, type NodeProps, type Node } from '@xyflow/react'
import type { BranchCase } from '@/lib/types'
import type { EditorNodeData } from '../nodeData'
import { statusDotClass } from '../nodeData'

function BranchNode({ data, selected }: NodeProps<Node<EditorNodeData>>) {
  const { node, run, issues } = data
  const cases: BranchCase[] = node.cases ?? []

  const setCase = (i: number, patch: Partial<BranchCase>) =>
    data.onChange({ cases: cases.map((c, j) => j === i ? { ...c, ...patch } : c) })
  const addCase = () => data.onChange({ cases: [...cases, { label: `case-${cases.length + 1}`, condition: '' }] })
  const removeCase = (i: number) => data.onChange({ cases: cases.filter((_, j) => j !== i) })

  return (
    <div className={`relative rounded-lg shadow-md border-2 min-w-[260px] bg-white ${issues.length ? 'border-red-400' : selected ? 'border-zinc-900 ring-4 ring-zinc-900/5' : 'border-zinc-200'}`}>
      <div className="px-4 py-2 border-b border-zinc-100 bg-zinc-50/50 rounded-t-lg flex items-center gap-2">
        <div className={`w-2 h-2 rounded-full ${statusDotClass(run)}`} />
        <span className="text-[9px] font-bold text-zinc-400 uppercase tracking-widest">Branch</span>
        <span className="text-xs font-bold text-zinc-900 ml-1">{node.id}</span>
      </div>
      <div className="px-4 py-2">
        <div className="relative pl-3 flex items-center h-5 text-[9px] font-mono text-zinc-400 mb-2">
          <Handle type="target" id="in" position={Position.Left}
            style={{ left: -16, top: '50%', transform: 'translateY(-50%)' }}
            className="w-2.5 h-2.5 border-2 border-white !bg-zinc-400" />
          <span>in</span>
        </div>

        <div className="space-y-1.5">
          {cases.map((c, i) => (
            <div key={i} className="relative flex items-center gap-1">
              <input value={c.label} onChange={e => setCase(i, { label: e.target.value })}
                className="w-16 text-[10px] font-mono border border-zinc-200 rounded px-1 py-0.5 nodrag" />
              <input value={c.condition} onChange={e => setCase(i, { condition: e.target.value })}
                placeholder="condition" className="flex-1 text-[10px] font-mono border border-zinc-200 rounded px-1 py-0.5 nodrag" />
              <button onClick={() => removeCase(i)} className="text-zinc-300 hover:text-red-500 text-xs nodrag">×</button>
              <Handle type="source" id={c.label} position={Position.Right}
                style={{ right: -16, top: '50%', transform: 'translateY(-50%)' }}
                className="w-2.5 h-2.5 border-2 border-white !bg-zinc-900" />
            </div>
          ))}
        </div>

        <button onClick={addCase} className="mt-2 text-[10px] font-bold text-zinc-500 hover:text-zinc-900 nodrag">+ case</button>

        <div className="mt-2 relative flex items-center gap-1 text-[10px] font-mono text-zinc-400">
          <span className="w-16">default</span>
          <input value={node.default ?? ''} onChange={e => data.onChange({ default: e.target.value })}
            placeholder="default label" className="flex-1 text-[10px] font-mono border border-zinc-200 rounded px-1 py-0.5 nodrag" />
          {node.default && (
            <Handle type="source" id={node.default} position={Position.Right}
              style={{ right: -16, top: '50%', transform: 'translateY(-50%)' }}
              className="w-2.5 h-2.5 border-2 border-white !bg-zinc-500" />
          )}
        </div>
      </div>
    </div>
  )
}
export default memo(BranchNode)
```

- [ ] **Step 3: Create `LoopStartNode`**

Create `components/editor/nodes/LoopStartNode.tsx`:

```tsx
'use client'
import React, { memo } from 'react'
import { Handle, Position, type NodeProps, type Node } from '@xyflow/react'
import type { EditorNodeData } from '../nodeData'

function LoopStartNode({ data, selected }: NodeProps<Node<EditorNodeData>>) {
  const { node, issues } = data
  const state = node.state ?? []
  const setName = (i: number, name: string) => data.onChange({ state: state.map((s, j) => j === i ? name : s) })
  const addName = () => data.onChange({ state: [...state, `state-${state.length + 1}`] })
  const removeName = (i: number) => data.onChange({ state: state.filter((_, j) => j !== i) })

  return (
    <div className={`relative rounded-lg shadow-md border-2 min-w-[220px] bg-amber-50/40 ${issues.length ? 'border-red-400' : selected ? 'border-amber-600 ring-4 ring-amber-600/10' : 'border-amber-300'}`}>
      <div className="px-4 py-2 border-b border-amber-200 rounded-t-lg flex items-center gap-2">
        <span className="text-[9px] font-bold text-amber-600 uppercase tracking-widest">Loop start</span>
        <span className="text-xs font-bold text-zinc-900 ml-1">{node.id}</span>
      </div>
      <div className="px-4 py-2">
        <label className="block text-[9px] font-bold text-zinc-400 uppercase tracking-widest mb-1">zone</label>
        <input value={node.zone ?? ''} onChange={e => data.onChange({ zone: e.target.value })}
          className="w-full text-[11px] font-mono border border-zinc-200 rounded px-2 py-1 nodrag mb-2" />

        <div className="space-y-1">
          {state.map((s, i) => (
            <div key={i} className="relative flex items-center gap-1 text-[10px] font-mono text-zinc-400">
              <Handle type="target" id={s} position={Position.Left}
                style={{ left: -16, top: '50%', transform: 'translateY(-50%)' }}
                className="w-2.5 h-2.5 border-2 border-white !bg-amber-400" />
              <input value={s} onChange={e => setName(i, e.target.value)}
                className="flex-1 text-[10px] font-mono border border-zinc-200 rounded px-1 py-0.5 nodrag" />
              <button onClick={() => removeName(i)} className="text-zinc-300 hover:text-red-500 text-xs nodrag">×</button>
              <Handle type="source" id={s} position={Position.Right}
                style={{ right: -16, top: '50%', transform: 'translateY(-50%)' }}
                className="w-2.5 h-2.5 border-2 border-white !bg-amber-500" />
            </div>
          ))}
        </div>
        <button onClick={addName} className="mt-2 text-[10px] font-bold text-zinc-500 hover:text-zinc-900 nodrag">+ state</button>
      </div>
    </div>
  )
}
export default memo(LoopStartNode)
```

- [ ] **Step 4: Create `LoopEndNode`**

Create `components/editor/nodes/LoopEndNode.tsx`:

```tsx
'use client'
import React, { memo } from 'react'
import { Handle, Position, type NodeProps, type Node } from '@xyflow/react'
import type { EditorNodeData } from '../nodeData'
import { statusDotClass } from '../nodeData'

function LoopEndNode({ data, selected }: NodeProps<Node<EditorNodeData>>) {
  const { node, inputs, outputs, run, issues } = data
  return (
    <div className={`relative rounded-lg shadow-md border-2 min-w-[220px] bg-amber-50/40 ${issues.length ? 'border-red-400' : selected ? 'border-amber-600 ring-4 ring-amber-600/10' : 'border-amber-300'}`}>
      <div className="px-4 py-2 border-b border-amber-200 rounded-t-lg flex items-center gap-2">
        <div className={`w-2 h-2 rounded-full ${statusDotClass(run)}`} />
        <span className="text-[9px] font-bold text-amber-600 uppercase tracking-widest">Loop end</span>
        <span className="text-xs font-bold text-zinc-900 ml-1">{node.id}</span>
      </div>
      <div className="px-4 py-2">
        <label className="block text-[9px] font-bold text-zinc-400 uppercase tracking-widest mb-1">zone</label>
        <input value={node.zone ?? ''} onChange={e => data.onChange({ zone: e.target.value })}
          className="w-full text-[11px] font-mono border border-zinc-200 rounded px-2 py-1 nodrag mb-2" />
        <label className="block text-[9px] font-bold text-zinc-400 uppercase tracking-widest mb-1">until</label>
        <input value={node.until ?? ''} onChange={e => data.onChange({ until: e.target.value })}
          placeholder='e.g. {ls.draft} contains "DONE"'
          className="w-full text-[11px] font-mono border border-zinc-200 rounded px-2 py-1 nodrag mb-2" />
        <label className="block text-[9px] font-bold text-zinc-400 uppercase tracking-widest mb-1">max iterations</label>
        <input type="number" min={1} value={node.maxIterations ?? 1}
          onChange={e => data.onChange({ maxIterations: parseInt(e.target.value) || 1 })}
          className="w-full text-[11px] font-mono border border-zinc-200 rounded px-2 py-1 nodrag mb-2" />

        <div className="flex justify-between gap-4 text-[9px] font-mono text-zinc-400">
          <div className="flex flex-col gap-1.5">
            {inputs.map(s => (
              <div key={s} className="relative pl-3 flex items-center h-5">
                <Handle type="target" id={s} position={Position.Left}
                  style={{ left: -16, top: '50%', transform: 'translateY(-50%)' }}
                  className="w-2.5 h-2.5 border-2 border-white !bg-amber-400" />
                <span>{s}</span>
              </div>
            ))}
          </div>
          <div className="flex flex-col gap-1.5 text-right">
            {outputs.map(s => (
              <div key={s} className="relative pr-3 flex items-center justify-end h-5">
                <span>.{s}</span>
                <Handle type="source" id={s} position={Position.Right}
                  style={{ right: -16, top: '50%', transform: 'translateY(-50%)' }}
                  className="w-2.5 h-2.5 border-2 border-white !bg-amber-500" />
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}
export default memo(LoopEndNode)
```

- [ ] **Step 5: Typecheck + lint**

Run: `npx tsc --noEmit && npm run lint`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add components/editor/nodes/GateNode.tsx components/editor/nodes/BranchNode.tsx components/editor/nodes/LoopStartNode.tsx components/editor/nodes/LoopEndNode.tsx
git commit -m "feat: add editor node components for gate/branch/loop-start/loop-end"
```

---

### Task 11: `ZoneFrame` component + `NodePalette`

The visual zone rectangle (a non-interactive React Flow node type) and the categorized, searchable palette that adds nodes.

**Files:**
- Create: `components/editor/nodes/ZoneFrame.tsx`
- Create: `components/editor/NodePalette.tsx`

**Interfaces:**
- Consumes: `ZoneFrameBox` (Task 5); `makeLoopZone`/`uniqueNodeId` (Task 4); `fuse.js`.
- Produces:
  - `ZoneFrame` default export (node type `zoneFrame`, data `{ zone: string; width: number; height: number }`).
  - `NodePalette` default export with props `{ onAdd: (kind: ChainNodeKind) => void; onAddLoopZone: () => void }`.

- [ ] **Step 1: Create `ZoneFrame`**

Create `components/editor/nodes/ZoneFrame.tsx`:

```tsx
'use client'
import React, { memo } from 'react'
import { type NodeProps, type Node } from '@xyflow/react'

export interface ZoneFrameData { zone: string; width: number; height: number; [key: string]: unknown }

function ZoneFrame({ data }: NodeProps<Node<ZoneFrameData>>) {
  return (
    <div
      style={{ width: data.width, height: data.height }}
      className="rounded-2xl border-2 border-dashed border-amber-300 bg-amber-100/20 pointer-events-none"
    >
      <span className="absolute -top-2 left-3 px-1.5 bg-amber-100 text-amber-700 text-[9px] font-bold uppercase tracking-widest rounded">
        loop: {data.zone}
      </span>
    </div>
  )
}
export default memo(ZoneFrame)
```

- [ ] **Step 2: Create `NodePalette`**

Create `components/editor/NodePalette.tsx`:

```tsx
'use client'
import React, { useMemo, useState } from 'react'
import Fuse from 'fuse.js'
import type { ChainNodeKind } from '@/lib/types'

interface PaletteItem { kind: ChainNodeKind | 'loop-zone'; label: string; group: string }

const ITEMS: PaletteItem[] = [
  { kind: 'seed', label: 'Seed', group: 'Sources' },
  { kind: 'context', label: 'Context', group: 'Sources' },
  { kind: 'agent', label: 'Agent', group: 'Agents' },
  { kind: 'decider', label: 'Decider', group: 'Agents' },
  { kind: 'gate', label: 'Gate', group: 'Control flow' },
  { kind: 'branch', label: 'Branch', group: 'Control flow' },
  { kind: 'loop-zone', label: 'Loop zone', group: 'Loop' },
]
const GROUPS = ['Sources', 'Agents', 'Control flow', 'Loop']

export default function NodePalette({ onAdd, onAddLoopZone }: {
  onAdd: (kind: ChainNodeKind) => void
  onAddLoopZone: () => void
}) {
  const [query, setQuery] = useState('')
  const fuse = useMemo(() => new Fuse(ITEMS, { keys: ['label', 'group'], threshold: 0.4 }), [])
  const visible = query.trim() ? fuse.search(query).map(r => r.item) : ITEMS

  const click = (item: PaletteItem) => {
    if (item.kind === 'loop-zone') onAddLoopZone()
    else onAdd(item.kind)
  }

  return (
    <div className="w-44 shrink-0 border-r border-zinc-100 bg-white p-3 overflow-auto">
      <input
        value={query}
        onChange={e => setQuery(e.target.value)}
        placeholder="Search nodes…"
        className="w-full text-xs border border-zinc-200 rounded px-2 py-1 mb-3"
      />
      {GROUPS.map(group => {
        const items = visible.filter(i => i.group === group)
        if (items.length === 0) return null
        return (
          <div key={group} className="mb-3">
            <div className="text-[9px] font-bold text-zinc-400 uppercase tracking-widest mb-1">{group}</div>
            <div className="flex flex-col gap-1">
              {items.map(item => (
                <button
                  key={item.kind}
                  onClick={() => click(item)}
                  className="text-left text-xs px-2 py-1 rounded border border-zinc-200 hover:bg-zinc-50 hover:border-zinc-300 transition-colors"
                >
                  {item.label}
                </button>
              ))}
            </div>
          </div>
        )
      })}
    </div>
  )
}
```

- [ ] **Step 3: Typecheck + lint**

Run: `npx tsc --noEmit && npm run lint`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add components/editor/nodes/ZoneFrame.tsx components/editor/NodePalette.tsx
git commit -m "feat: add ZoneFrame node and categorized+searchable NodePalette"
```

---

### Task 12: `ChainCanvas` — controlled React Flow surface

The interactive canvas: renders editor nodes + zone frames, handles drag (position), connect (with replace-occupied-input), and delete. Stateless about persistence — it calls callbacks.

**Files:**
- Create: `components/editor/ChainCanvas.tsx`

**Interfaces:**
- Consumes: all node components (Tasks 9–11); `computeZoneFrames` (Task 5); `connectEdge`/`deleteNode`/`deleteEdge` (Task 4); `ChainNode`/`ChainEdge` from `lib/types`; `EditorNodeData` (Task 9).
- Produces: `ChainCanvas` default export with props:

```ts
interface ChainCanvasProps {
  nodes: ChainNode[]
  edges: ChainEdge[]
  buildData: (node: ChainNode) => EditorNodeData
  selectedId: string | null
  onSelect: (id: string | null) => void
  onMove: (id: string, pos: [number, number]) => void
  onConnect: (edge: ChainEdge) => void
  onDeleteNode: (id: string) => void
  onDeleteEdge: (edge: ChainEdge) => void
}
```

- [ ] **Step 1: Write the component**

Create `components/editor/ChainCanvas.tsx`:

```tsx
'use client'
import React, { useMemo } from 'react'
import {
  ReactFlow, Background, Controls, ReactFlowProvider,
  type Node, type Edge, type NodeTypes, type Connection,
} from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import type { ChainNode, ChainEdge } from '@/lib/types'
import type { EditorNodeData } from './nodeData'
import { computeZoneFrames } from '@/lib/zoneFrames'
import SeedNode from './nodes/SeedNode'
import ContextNode from './nodes/ContextNode'
import AgentNode from './nodes/AgentNode'
import GateNode from './nodes/GateNode'
import BranchNode from './nodes/BranchNode'
import LoopStartNode from './nodes/LoopStartNode'
import LoopEndNode from './nodes/LoopEndNode'
import ZoneFrame from './nodes/ZoneFrame'

const nodeTypes: NodeTypes = {
  seed: SeedNode, context: ContextNode, agent: AgentNode, decider: AgentNode,
  gate: GateNode, branch: BranchNode, 'loop-start': LoopStartNode, 'loop-end': LoopEndNode,
  zoneFrame: ZoneFrame,
}

interface ChainCanvasProps {
  nodes: ChainNode[]
  edges: ChainEdge[]
  buildData: (node: ChainNode) => EditorNodeData
  selectedId: string | null
  onSelect: (id: string | null) => void
  onMove: (id: string, pos: [number, number]) => void
  onConnect: (edge: ChainEdge) => void
  onDeleteNode: (id: string) => void
  onDeleteEdge: (edge: ChainEdge) => void
}

function edgeId(e: ChainEdge): string {
  return `${e.fromNode}.${e.fromSocket}->${e.toNode}.${e.toSocket}`
}

export default function ChainCanvas(props: ChainCanvasProps) {
  const rfNodes = useMemo<Node[]>(() => {
    const frames: Node[] = computeZoneFrames(props.nodes).map(f => ({
      id: `zone-frame-${f.zone}`,
      type: 'zoneFrame',
      position: { x: f.x, y: f.y },
      data: { zone: f.zone, width: f.width, height: f.height },
      selectable: false,
      draggable: false,
      zIndex: -1,
    }))
    const nodes: Node[] = props.nodes.map(n => ({
      id: n.id,
      type: n.kind,
      position: { x: n.pos?.[0] ?? 0, y: n.pos?.[1] ?? 0 },
      data: props.buildData(n),
      selected: n.id === props.selectedId,
    }))
    return [...frames, ...nodes]
  }, [props.nodes, props.selectedId, props.buildData])

  const rfEdges = useMemo<Edge[]>(() => props.edges.map(e => ({
    id: edgeId(e),
    source: e.fromNode,
    sourceHandle: e.fromSocket,
    target: e.toNode,
    targetHandle: e.toSocket,
    animated: true,
    style: { stroke: '#a1a1aa', strokeWidth: 2 },
  })), [props.edges])

  return (
    <div className="w-full h-full bg-zinc-50">
      <ReactFlowProvider>
        <ReactFlow
          nodes={rfNodes}
          edges={rfEdges}
          nodeTypes={nodeTypes}
          onNodeClick={(_, node) => props.onSelect(node.id)}
          onPaneClick={() => props.onSelect(null)}
          onNodeDragStop={(_, node) => props.onMove(node.id, [node.position.x, node.position.y])}
          onConnect={(c: Connection) => {
            if (!c.source || !c.target || !c.sourceHandle || !c.targetHandle) return
            if (c.source === c.target) return
            props.onConnect({ fromNode: c.source, fromSocket: c.sourceHandle, toNode: c.target, toSocket: c.targetHandle })
          }}
          onNodesDelete={(deleted) => deleted.forEach(d => props.onDeleteNode(d.id))}
          onEdgesDelete={(deleted) => deleted.forEach(d => {
            const e = props.edges.find(x => edgeId(x) === d.id)
            if (e) props.onDeleteEdge(e)
          })}
          fitView
          proOptions={{ hideAttribution: true }}
        >
          <Background color="#e5e7eb" gap={20} />
          <Controls showInteractive={false} />
        </ReactFlow>
      </ReactFlowProvider>
    </div>
  )
}
```

- [ ] **Step 2: Typecheck + lint**

Run: `npx tsc --noEmit && npm run lint`
Expected: no errors. If `@xyflow/react` types flag `onNodesDelete`/`onEdgesDelete` signatures, consult `node_modules/@xyflow/react` types and adjust the callback parameter types to match the installed version.

- [ ] **Step 3: Commit**

```bash
git add components/editor/ChainCanvas.tsx
git commit -m "feat: add controlled ChainCanvas (drag/connect/delete + zone frames)"
```

---

### Task 13: `ChainEditor` — container wiring (state, autosave, validation)

The top-level editor: loads agents/context, holds nodes/edges, applies mutations via `editorOps`, serializes to markdown into `useAutoSave`, runs live validation, seeds positions for YAML-authored chains, and renders palette + canvas + validation panel. (Run/preview added in Task 14.)

**Files:**
- Create: `components/editor/ChainEditor.tsx`
- Create: `components/editor/ValidationPanel.tsx`

**Interfaces:**
- Consumes: `serializeChain` (Task 2); `useAutoSave` w/ `flush` (Task 8); `validateChain` (Task 3); `inputSocketsOf`/`outputSocketsOf` (Task 1); `editorOps` (Task 4); `NodePalette` (Task 11); `ChainCanvas` (Task 12); dagre layout (mirroring `RunGraph`).
- Produces: `ChainEditor` default export with props `{ slug: string; initialChain: ChainDef; agents: AgentDef[]; contextFiles: { slug: string; name: string }[] }`. `ValidationPanel` default export `{ issues: ValidationIssue[]; onSelect: (id: string | null) => void }`.

- [ ] **Step 1: Create `ValidationPanel`**

Create `components/editor/ValidationPanel.tsx`:

```tsx
'use client'
import React from 'react'
import type { ValidationIssue } from '@/lib/types'

export default function ValidationPanel({ issues, onSelect }: {
  issues: ValidationIssue[]
  onSelect: (id: string | null) => void
}) {
  if (issues.length === 0) {
    return <div className="px-4 py-2 text-[11px] text-green-600 border-t border-zinc-100">✓ No validation issues</div>
  }
  return (
    <div className="border-t border-zinc-100 bg-red-50/40 max-h-32 overflow-auto">
      <div className="px-4 py-1.5 text-[10px] font-bold text-red-600 uppercase tracking-widest">{issues.length} issue(s)</div>
      <ul className="px-2 pb-2 space-y-0.5">
        {issues.map((i, idx) => (
          <li key={idx}>
            <button
              onClick={() => onSelect(i.nodeId ?? i.edge?.toNode ?? null)}
              className="w-full text-left text-[11px] text-red-700 hover:bg-red-100/60 rounded px-2 py-0.5"
            >
              {i.message}
            </button>
          </li>
        ))}
      </ul>
    </div>
  )
}
```

- [ ] **Step 2: Create `ChainEditor`**

Create `components/editor/ChainEditor.tsx`:

```tsx
'use client'
import React, { useCallback, useMemo, useState } from 'react'
import dagre from 'dagre'
import { useAutoSave } from '@/hooks/useAutoSave'
import { serializeChain } from '@/lib/serializeChain'
import { validateChain } from '@/lib/chainGraph'
import { inputSocketsOf, outputSocketsOf } from '@/lib/nodeSockets'
import { connectEdge, deleteNode as opDeleteNode, deleteEdge as opDeleteEdge, uniqueNodeId, makeLoopZone } from '@/lib/editorOps'
import type { ChainDef, ChainNode, ChainEdge, AgentDef, ChainNodeKind } from '@/lib/types'
import type { EditorNodeData } from './nodeData'
import ChainCanvas from './ChainCanvas'
import NodePalette from './NodePalette'
import ValidationPanel from './ValidationPanel'

const NODE_W = 240, NODE_H = 120

function seedPositions(nodes: ChainNode[], edges: ChainEdge[]): ChainNode[] {
  if (nodes.every(n => n.pos)) return nodes
  const g = new dagre.graphlib.Graph()
  g.setDefaultEdgeLabel(() => ({}))
  g.setGraph({ rankdir: 'LR', nodesep: 40, ranksep: 90 })
  nodes.forEach(n => g.setNode(n.id, { width: NODE_W, height: NODE_H }))
  edges.forEach(e => g.setEdge(e.fromNode, e.toNode))
  dagre.layout(g)
  return nodes.map(n => n.pos ? n : { ...n, pos: [g.node(n.id).x - NODE_W / 2, g.node(n.id).y - NODE_H / 2] as [number, number] })
}

export default function ChainEditor({ slug, initialChain, agents, contextFiles }: {
  slug: string
  initialChain: ChainDef
  agents: AgentDef[]
  contextFiles: { slug: string; name: string }[]
}) {
  const [nodes, setNodes] = useState<ChainNode[]>(() => seedPositions(initialChain.nodes, initialChain.edges))
  const [edges, setEdges] = useState<ChainEdge[]>(initialChain.edges)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const meta = useMemo(() => ({ name: initialChain.name, description: initialChain.description }), [initialChain])

  const initialMarkdown = useMemo(() => serializeChain(meta, seedPositions(initialChain.nodes, initialChain.edges), initialChain.edges), [meta, initialChain])
  const { setContent, status, flush } = useAutoSave('chain', slug, initialMarkdown)

  // Push every graph change into the autosave pipeline as serialized markdown.
  const sync = useCallback((nextNodes: ChainNode[], nextEdges: ChainEdge[]) => {
    setContent(serializeChain(meta, nextNodes, nextEdges))
  }, [meta, setContent])

  const chain: ChainDef = useMemo(() => ({ ...initialChain, nodes, edges }), [initialChain, nodes, edges])
  const validation = useMemo(() => validateChain(chain, agents), [chain, agents])

  const issuesByNode = useMemo(() => {
    const m = new Map<string, string[]>()
    for (const i of validation.issues) {
      const id = i.nodeId ?? i.edge?.toNode
      if (!id) continue
      m.set(id, [...(m.get(id) ?? []), i.message])
    }
    return m
  }, [validation])

  const updateNode = useCallback((id: string, patch: Partial<ChainNode>) => {
    setNodes(prev => {
      const next = prev.map(n => n.id === id ? { ...n, ...patch } : n)
      sync(next, edges)
      return next
    })
  }, [edges, sync])

  const moveNode = useCallback((id: string, pos: [number, number]) => {
    setNodes(prev => {
      const next = prev.map(n => n.id === id ? { ...n, pos } : n)
      sync(next, edges)
      return next
    })
  }, [edges, sync])

  const addNodeOfKind = useCallback((kind: ChainNodeKind) => {
    setNodes(prev => {
      const id = uniqueNodeId(kind, prev.map(n => n.id))
      const node: ChainNode = { id, kind, pos: [80, 80] }
      const next = [...prev, node]
      sync(next, edges)
      return next
    })
  }, [edges, sync])

  const addLoopZone = useCallback(() => {
    setNodes(prev => {
      const pair = makeLoopZone(prev.map(n => n.id), [120, 120])
      const next = [...prev, ...pair]
      sync(next, edges)
      return next
    })
  }, [edges, sync])

  const connect = useCallback((edge: ChainEdge) => {
    setEdges(prev => {
      const next = connectEdge(prev, edge)
      sync(nodes, next)
      return next
    })
  }, [nodes, sync])

  const deleteNode = useCallback((id: string) => {
    const res = opDeleteNode(nodes, edges, id)
    setNodes(res.nodes); setEdges(res.edges); sync(res.nodes, res.edges)
    if (selectedId === id) setSelectedId(null)
  }, [nodes, edges, sync, selectedId])

  const deleteEdge = useCallback((edge: ChainEdge) => {
    setEdges(prev => {
      const next = opDeleteEdge(prev, edge)
      sync(nodes, next)
      return next
    })
  }, [nodes, sync])

  const buildData = useCallback((node: ChainNode): EditorNodeData => ({
    node,
    inputs: inputSocketsOf(node, chain, agents),
    outputs: outputSocketsOf(node, chain, agents),
    agents: agents.map(a => ({ slug: a.slug, name: a.name })),
    contextFiles,
    issues: issuesByNode.get(node.id) ?? [],
    onChange: patch => updateNode(node.id, patch),
  }), [chain, agents, contextFiles, issuesByNode, updateNode])

  return (
    <div className="h-full flex flex-col">
      <div className="flex-1 min-h-0 flex">
        <NodePalette onAdd={addNodeOfKind} onAddLoopZone={addLoopZone} />
        <div className="flex-1 min-w-0 relative">
          <div className="absolute top-2 right-2 z-10 text-[10px] font-bold text-zinc-400 uppercase tracking-widest">{status}</div>
          <ChainCanvas
            nodes={nodes}
            edges={edges}
            buildData={buildData}
            selectedId={selectedId}
            onSelect={setSelectedId}
            onMove={moveNode}
            onConnect={connect}
            onDeleteNode={deleteNode}
            onDeleteEdge={deleteEdge}
          />
        </div>
      </div>
      <ValidationPanel issues={validation.issues} onSelect={setSelectedId} />
    </div>
  )
}
```

- [ ] **Step 3: Typecheck + lint**

Run: `npx tsc --noEmit && npm run lint`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add components/editor/ChainEditor.tsx components/editor/ValidationPanel.tsx
git commit -m "feat: add ChainEditor container (state, autosave round-trip, live validation)"
```

---

### Task 14: Run + live preview wiring

Add the Run button, seed-prompt input, save-then-run flush, SSE consumption via `streamRun`, per-node live status via `applyRunEvent`, and a bottom preview panel for the selected node.

**Files:**
- Modify: `components/editor/ChainEditor.tsx`
- Create: `components/editor/NodePreview.tsx`

**Interfaces:**
- Consumes: `streamRun` (Task 6); `applyRunEvent`/`RunStateMap` (Task 7); `flush` from `useAutoSave` (Task 8).
- Produces: `NodePreview` default export `{ run?: NodeRunState; nodeId: string | null }`; `EditorNodeData.run` populated from the run-state map.

- [ ] **Step 1: Create `NodePreview`**

Create `components/editor/NodePreview.tsx`:

```tsx
'use client'
import React from 'react'
import type { NodeRunState } from '@/lib/runState'

export default function NodePreview({ run, nodeId }: { run?: NodeRunState; nodeId: string | null }) {
  if (!nodeId) return <div className="px-4 py-3 text-[11px] text-zinc-400 italic">Select a node to preview its output.</div>
  if (!run) return <div className="px-4 py-3 text-[11px] text-zinc-400 italic">No run output for “{nodeId}” yet.</div>
  return (
    <div className="px-4 py-3 overflow-auto">
      <div className="text-[10px] font-bold text-zinc-400 uppercase tracking-widest mb-1">{nodeId} · {run.status}</div>
      {run.rounds.length > 1 ? (
        run.rounds.map(r => (
          <div key={r.round} className="mb-2">
            <div className="text-[9px] font-bold text-zinc-400">round {r.round}</div>
            <pre className="text-[11px] whitespace-pre-wrap text-zinc-700">{r.output}</pre>
          </div>
        ))
      ) : (
        <pre className="text-[11px] whitespace-pre-wrap text-zinc-700">{run.output}</pre>
      )}
      {run.thought && <pre className="mt-2 text-[10px] whitespace-pre-wrap text-zinc-400 border-t border-zinc-100 pt-2">{run.thought}</pre>}
    </div>
  )
}
```

- [ ] **Step 2: Wire run state + Run into `ChainEditor`**

In `components/editor/ChainEditor.tsx`, add imports:

```ts
import { streamRun } from '@/lib/runStream'
import { applyRunEvent, type RunStateMap } from '@/lib/runState'
import NodePreview from './NodePreview'
import { Play } from 'lucide-react'
```

Add state near the other `useState`s:

```ts
  const [runState, setRunState] = useState<RunStateMap>({})
  const [seedPrompt, setSeedPrompt] = useState('')
  const [running, setRunning] = useState(false)
  const [runError, setRunError] = useState<string | null>(null)
```

Add the run handler (after the other callbacks):

```ts
  const run = useCallback(async () => {
    setRunError(null)
    setRunState({})
    setRunning(true)
    try {
      await flush(serializeChain(meta, nodes, edges)) // save-then-run: disk = canvas
      const res = await fetch('/api/run', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chainName: slug, seedPrompt, type: 'chain', slug }),
      })
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        setRunError((body.errors as string[] | undefined)?.join('; ') ?? body.error ?? `Run failed (${res.status})`)
        return
      }
      const reader = res.body?.getReader()
      if (!reader) return
      await streamRun(reader, e => {
        if (e.type === 'error') { setRunError(e.error); return }
        setRunState(prev => applyRunEvent(prev, e))
      })
    } catch (err) {
      setRunError(err instanceof Error ? err.message : String(err))
    } finally {
      setRunning(false)
    }
  }, [flush, meta, nodes, edges, slug, seedPrompt])
```

Add `run: runState[node.id]` to the object returned by `buildData`:

```ts
    run: runState[node.id],
```

(Add `runState` to `buildData`'s dependency array.)

Add a toolbar above the canvas area and the preview panel at the bottom. Replace the top of the returned JSX (the `<div className="h-full flex flex-col">` block) so it includes the toolbar, and append the preview panel after `ValidationPanel`:

```tsx
  return (
    <div className="h-full flex flex-col">
      <div className="px-4 py-2 border-b border-zinc-100 flex items-center gap-3">
        <input
          value={seedPrompt}
          onChange={e => setSeedPrompt(e.target.value)}
          placeholder="Seed prompt ({input})…"
          className="flex-1 text-xs border border-zinc-200 rounded px-2 py-1"
        />
        <button
          onClick={run}
          disabled={running}
          className="flex items-center gap-1.5 px-3 py-1.5 bg-zinc-900 text-white text-xs font-medium rounded-md hover:bg-zinc-800 disabled:opacity-50"
        >
          <Play size={12} className="fill-current" />
          {running ? 'Running…' : 'Run'}
        </button>
        <span className="text-[10px] font-bold text-zinc-400 uppercase tracking-widest">{status}</span>
      </div>

      {runError && <div className="px-4 py-1.5 text-[11px] text-red-600 bg-red-50 border-b border-red-100">{runError}</div>}

      <div className="flex-1 min-h-0 flex">
        <NodePalette onAdd={addNodeOfKind} onAddLoopZone={addLoopZone} />
        <div className="flex-1 min-w-0 relative">
          <ChainCanvas
            nodes={nodes}
            edges={edges}
            buildData={buildData}
            selectedId={selectedId}
            onSelect={setSelectedId}
            onMove={moveNode}
            onConnect={connect}
            onDeleteNode={deleteNode}
            onDeleteEdge={deleteEdge}
          />
        </div>
      </div>

      <ValidationPanel issues={validation.issues} onSelect={setSelectedId} />
      <div className="h-40 border-t border-zinc-200 bg-white overflow-hidden">
        <NodePreview run={selectedId ? runState[selectedId] : undefined} nodeId={selectedId} />
      </div>
    </div>
  )
```

(Remove the now-duplicated standalone `status` indicator `<div className="absolute top-2 right-2 …">` introduced in Task 13, since status now lives in the toolbar.)

- [ ] **Step 3: Typecheck + lint**

Run: `npx tsc --noEmit && npm run lint`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add components/editor/ChainEditor.tsx components/editor/NodePreview.tsx
git commit -m "feat: run-in-editor with save-then-run flush and live per-node previews"
```

---

### Task 15: Workspace page — Graph/YAML toggle + parse fallback

Mount `ChainEditor` for chains behind a Graph/YAML toggle (Graph default), loading agents/context for the editor, with a non-blocking fallback to YAML if the chain can't be parsed as a graph.

**Files:**
- Modify: `app/workspace/page.tsx`

**Interfaces:**
- Consumes: `ChainEditor` (Tasks 13–14); `parseChainContent` from `lib/fs/parseChain`; `GET /api/workspace` (agents + context).

- [ ] **Step 1: Add imports and editor state**

In `app/workspace/page.tsx`, add imports:

```ts
import ChainEditor from '@/components/editor/ChainEditor';
import { parseChainContent } from '@/lib/fs/parseChain';
import { ChainDef, AgentDef } from '@/lib/types';
import { Network, FileCode } from 'lucide-react';
```

Add state inside `WorkspaceContent` (near the other `useState`s):

```ts
  const [chainView, setChainView] = useState<'graph' | 'yaml'>('graph');
  const [editorAgents, setEditorAgents] = useState<AgentDef[]>([]);
  const [editorContext, setEditorContext] = useState<{ slug: string; name: string }[]>([]);
```

Fetch agents/context once when a chain is open (add after the existing content `useEffect`):

```ts
  useEffect(() => {
    if (type !== 'chain') return;
    fetch('/api/workspace')
      .then(r => r.json())
      .then(w => { setEditorAgents(w.agents ?? []); setEditorContext(w.context ?? []); })
      .catch(() => { setEditorAgents([]); setEditorContext([]); });
  }, [type, slug]);
```

- [ ] **Step 2: Parse the open chain into a `ChainDef` (with fallback)**

Add a memo deriving the parsed chain from the loaded raw content (`initialContent`):

```ts
  const parsedChain = useMemo<ChainDef | null>(() => {
    if (type !== 'chain' || !slug || !initialContent) return null;
    try {
      return { ...parseChainContent(initialContent, slug), filePath: '' };
    } catch {
      return null;
    }
  }, [type, slug, initialContent]);
```

(Add `useMemo` to the React import at the top.)

- [ ] **Step 3: Render the toggle + editor**

In the main editor `<Panel>` (the one wrapping `<FileEditor>`), replace its inner `<div className="h-full p-6 pt-4">…</div>` with a branch on chain view. Use:

```tsx
              <div className="h-full flex flex-col">
                {type === 'chain' && (
                  <div className="flex items-center gap-1 px-6 pt-3">
                    <button
                      onClick={() => setChainView('graph')}
                      className={`flex items-center gap-1.5 px-2.5 py-1 text-xs rounded-md border ${chainView === 'graph' ? 'bg-zinc-900 text-white border-zinc-900' : 'bg-white text-zinc-500 border-zinc-200'}`}
                    >
                      <Network size={12} /> Graph
                    </button>
                    <button
                      onClick={() => setChainView('yaml')}
                      className={`flex items-center gap-1.5 px-2.5 py-1 text-xs rounded-md border ${chainView === 'yaml' ? 'bg-zinc-900 text-white border-zinc-900' : 'bg-white text-zinc-500 border-zinc-200'}`}
                    >
                      <FileCode size={12} /> YAML
                    </button>
                    {chainView === 'graph' && !parsedChain && (
                      <span className="ml-2 text-[11px] text-amber-600">Couldn’t parse as a graph — showing YAML</span>
                    )}
                  </div>
                )}
                <div className="flex-1 min-h-0">
                  {type === 'chain' && chainView === 'graph' && parsedChain ? (
                    <ChainEditor
                      key={slug}
                      slug={slug}
                      initialChain={parsedChain}
                      agents={editorAgents}
                      contextFiles={editorContext}
                    />
                  ) : (
                    <div className="h-full p-6 pt-4">
                      <FileEditor
                        content={content}
                        onChange={setContent}
                        status={status}
                        error={saveError}
                        type={type}
                        language={type === 'agent' || type === 'skill' || type === 'chain' || type === 'template' ? 'markdown' : 'yaml'}
                      />
                    </div>
                  )}
                </div>
              </div>
```

(When `type === 'chain' && chainView === 'graph'` but `parsedChain` is null, the `else` branch renders the YAML editor — the fallback.)

- [ ] **Step 4: Typecheck + lint + build**

Run: `npx tsc --noEmit && npm run lint && npm run build`
Expected: typecheck/lint clean; build succeeds.

- [ ] **Step 5: Commit**

```bash
git add app/workspace/page.tsx
git commit -m "feat: Graph/YAML toggle mounting ChainEditor for chains (graph default)"
```

---

### Task 16: End-to-end manual smoke + round-trip verification

A scripted manual pass confirming authoring, persistence round-trip, and live previews on the real example chains. No new automated tests; this is the integration gate.

**Files:**
- None (verification only). If a defect is found, fix it in the owning task's file and re-commit.

- [ ] **Step 1: Round-trip the example chains through serialize (automated check)**

Create a temporary check and run it, then delete it:

```bash
cat > /tmp/roundtrip-check.ts <<'EOF'
import fs from 'fs'
import { parseChain } from './lib/fs/parseChain'
import { serializeChain } from './lib/serializeChain'
import { parseChainContent } from './lib/fs/parseChain'
import assert from 'node:assert'
for (const f of ['story-chain', 'triage-demo', 'refine-loop']) {
  const p = `workspace/chains/${f}.md`
  if (!fs.existsSync(p)) { console.log('skip', f); continue }
  const c = parseChain(p)
  const c2 = parseChainContent(serializeChain({ name: c.name, description: c.description }, c.nodes, c.edges), c.slug)
  assert.deepStrictEqual({ nodes: c2.nodes, edges: c2.edges }, { nodes: c.nodes, edges: c.edges })
  console.log('round-trip ok:', f)
}
EOF
npx tsx /tmp/roundtrip-check.ts && rm /tmp/roundtrip-check.ts
```

Expected: `round-trip ok:` for each existing example chain.

- [ ] **Step 2: Author + persist smoke**

`npm run dev`, open a chain in the workspace (Graph view). Verify:
- Palette adds nodes (each category; "Loop zone" adds a start/end pair with a dashed frame around them).
- Dragging a node persists position (status shows "saved"; reload the page → node stays put).
- Wiring an output→input handle creates an edge; wiring a second edge into the same input replaces the first.
- Editing inline fields (agent dropdown, gate condition, branch cases, loop until/maxIterations) persists (reload → values retained; check the `.md` on disk reflects them).

- [ ] **Step 3: Validation smoke**

Introduce an error (e.g., clear a gate condition, or wire a branch case with no matching label). Verify the offending node shows a red border + count and the issue appears in the validation panel; clicking the issue selects the node.

- [ ] **Step 4: Run + live preview smoke**

Enter a seed prompt, click **Run**. Verify nodes light up running→done, output streams onto agent nodes, skipped nodes grey out, and clicking a node shows its full output (per-round for the `refine-loop` loop body) in the bottom preview panel. Confirm a new run trace also appears in the history page (persistence unchanged).

- [ ] **Step 5: YAML fallback smoke**

Switch to YAML view, confirm the same chain renders as frontmatter and edits there still autosave. Temporarily corrupt the frontmatter and confirm Graph view shows the "couldn't parse as a graph" fallback to YAML rather than crashing.

- [ ] **Step 6: Commit (if any fixes were made)**

```bash
git add -A
git commit -m "fix: address issues found in Phase 4 end-to-end smoke"
```

---

## Self-Review

**1. Spec coverage** (each design section → task):
- §2 architecture / file structure → Tasks 1–15 create exactly the files listed (`serializeChain`, `runStream`, `ChainEditor`, `ChainCanvas`, `nodes/*`, `ZoneFrame`, `NodePalette`, `ValidationPanel`, `useChainEditor` logic folded into `ChainEditor` + pure modules, validator/types/useAutoSave/workspace modifications). ✓
- §3 persistence/round-trip → Task 2 (`serializeChain` + round-trip invariant), Task 13 (serialize→`useAutoSave`), Task 13 `seedPositions` (dagre position seeding), Task 15 (mutual-exclusion via toggle, flush on switch is implicit since only one view mounts and run flushes). ✓
- §4 inline editing model → Tasks 9–10 (per-kind fields per the table), Task 11 (palette categories + loop-zone pair), Task 5/11 (zone frame), Task 12 (`onConnect` replace-occupied-input, self-loop reject, delete). ✓
- §5 run/live preview → Tasks 6, 7, 8, 14 (save-then-run flush, streamRun, applyRunEvent, node status, preview panel, ephemeral run state separate from graph). ✓
- §6 validation → Task 3 (structured issues), Task 13 (live validation + issuesByNode), Task 14/13 (server stays gatekeeper; Run not hard-disabled). ✓
- §7 error handling → Task 15 (unparseable fallback), Task 8/13 (save failure surfaced via `status`), Task 14 (400 → show errors, abort), Tasks 9–10 (def-missing reflected via empty sockets/issues), Task 4/3 (loop-pair delete raises issue, not corruption). ✓
- §8 testing → pure modules TDD'd (Tasks 1–7); UI typecheck/lint/smoke (Tasks 9–16); example round-trip (Task 16). ✓

**2. Placeholder scan:** No TBD/TODO; every code step shows complete code; commands have expected output. The only intentional "describe-then-apply" steps are the mechanical push-site edits in Task 3 Step 4, which enumerate each site with the exact ref to attach. ✓

**3. Type consistency:** `EditorNodeData` (Task 9) is consumed unchanged by Tasks 10/12/13; `RunEvent` (Task 6) is consumed by Tasks 7/14; `applyRunEvent`/`RunStateMap`/`NodeRunState` names consistent across Tasks 7/9/14; `inputSocketsOf`/`outputSocketsOf(node, chain, agents)` signature identical in Tasks 1/13; `connectEdge`/`deleteNode`/`deleteEdge`/`makeLoopZone`/`uniqueNodeId` signatures identical in Tasks 4/13; `serializeChain(meta, nodes, edges)` identical in Tasks 2/13/14; `flush(override?)` (Task 8) used with an override in Task 14. ✓

**One scope note:** `useChainEditor.ts` from the design is realized inline inside `ChainEditor` (the state + callbacks are small and cohesive there); the pure logic it would have wrapped lives in the separately-tested `editorOps`/`serializeChain`/`nodeSockets` modules. This keeps behavior identical to the design while avoiding an extra thin indirection.
