# Phase 5 — Group C (Hard) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the two architectural items — subgraph / nested-chain nodes (§2.4) as a **Blender-style node group** (a referenced chain declares named inputs/outputs; subchain nodes inherit them as wireable sockets), and external-edit file-watch sync (§2.8) with a real conflict story.

**Architecture:** §2.4 mirrors the **loop node**: a chain declares public ports (`ChainPort[]`), the executor injects wired input values into the inner chain's seed nodes and stores each declared output under a per-socket key (`${nodeId}::${slug(name)}`), and `socketValue` gains a `subchain` case that reads per-socket — so the user wires exactly the outputs they want downstream. Cross-chain cycles are caught by a pure reference-graph walk; a depth guard backstops it. §2.8 watches the entity file with `chokidar` over an SSE route; a pure `reconcileExternalEdit` decides ignore-echo / adopt / conflict.

**Tech Stack:** Next.js 16 (app router, **Node runtime** for the watch route), React 19, `@xyflow/react` v12, `chokidar ^5`, `tsx` tests.

**Design source:** `docs/maestro/plans/2026-06-29-phase5-backlog-design.md` (Group C, §2.4 "Blender node-group model"). **Assumes Groups A and B are merged** (reducer + `setGraph` action, inline run, `seedPositions`).

## Global Constraints

- **Next.js 16 — consult the project skill.** Before writing the watch route (Task 7), read `.agents/skills/nextjs16.md` (authoritative), then `node_modules/next/dist/docs/` for gaps. For the SSE watch route: `req.nextUrl.searchParams` is **synchronous** — do **not** `await` it (only the `searchParams`/`params` *props* and `cookies()`/`headers()` are async); set `runtime = 'nodejs'` (chokidar needs Node) and `dynamic = 'force-dynamic'` (a `GET` stream must not be cached).
- **React Flow v12 (@xyflow/react) — consult the project skill.** Read `.agents/skills/xyflow12.md` before adding `SubchainNode` (Task 6): **named imports only**, `NodeProps<Node<EditorNodeData>>` typing (matches the existing nodes), **no direct mutation**.
- **§2.4 model (Blender node-group):** exposure is declared **once on the referenced chain** (`ChainDef.inputs`/`outputs`), and is **multi-input and multi-output**. Mechanism mirrors the loop node: declared names → per-socket storage `${nodeId}::${slug(name)}` → a per-socket `socketValue` lookup. Inline visual expansion of the inner graph is still deferred (the node renders its interface sockets + an "Open chain →" link).
- **`chains` is an optional argument** (`= []`) wherever added, so existing callers keep compiling.
- **Tests are framework-free scripts** (`node:assert`, `npx tsx tests/<file>.test.ts`, end with `console.log('✅ … passed')`). UI tasks end with manual verification, then commit. One commit per task.

---

## File Structure

**§2.4 subchain node group**
- Modify: `lib/types.ts` — `'subchain'` kind, `subchain?` field, `ChainPort`, `ChainDef.inputs?/outputs?`.
- Modify: `lib/serializeChain.ts`, `lib/parseChain.ts` — round-trip the field + chain ports.
- Create: `tests/subchain-roundtrip.test.ts`.
- Modify: `lib/nodeSockets.ts` — subchain sockets from the referenced chain's ports (new `chains` arg).
- Modify: `lib/resolveNode.ts` — `subchain` per-socket `socketValue` case + `seed` injection tweak.
- Modify: `lib/chainGraph.ts` — `validateChain(…, chains?)`, `validateSubchains` (unknown ref / cycle / no-outputs), subchain in `allowedKinds`/`acceptsInputs`, socket calls pass `chains`.
- Create: `tests/nodesockets-subchain.test.ts`, `tests/validate-subchain.test.ts`.
- Modify: `lib/executor.ts` — `runChainGraph(…, chains?, depth?)` + multi-input injection + multi-output per-socket storage + depth guard.
- Create: `tests/executor-subchain.test.ts`.
- Create: `components/editor/InterfacePanel.tsx` (declare a chain's ports), `components/editor/nodes/SubchainNode.tsx`.
- Modify: `components/editor/ChainCanvas.tsx`, `components/editor/NodePalette.tsx`, `components/editor/nodeData.ts`, `components/editor/ChainEditor.tsx`, `app/workspace/page.tsx`, `app/api/run/route.ts`.

**§2.8 file-watch sync**
- Create: `lib/syncReconcile.ts` + `tests/sync-reconcile.test.ts`.
- Create: `app/api/watch/route.ts`, `hooks/useFileWatch.ts`.
- Modify: `hooks/useAutoSave.ts` (expose `getLastSaved`), `components/editor/ChainEditor.tsx`.

---

## Task 1: Subchain data model + chain interface + round-trip (§2.4)

Add the node kind, the field, and the chain-level `ChainPort` interface; make all of it survive serialize → parse.

**Files:**
- Modify: `lib/types.ts`, `lib/serializeChain.ts`, `lib/parseChain.ts`
- Test: `tests/subchain-roundtrip.test.ts`

**Interfaces:**
- Produces: `ChainNodeKind` includes `'subchain'`; `ChainNode.subchain?: string`; `interface ChainPort { name: string; node: string; socket?: string }`; `ChainDef.inputs?: ChainPort[]`, `ChainDef.outputs?: ChainPort[]`; `chainToData`/`serializeChain` accept ports on `meta`.

- [ ] **Step 1: Write the failing round-trip test.** New file `tests/subchain-roundtrip.test.ts`:

```ts
import assert from 'node:assert'
import { serializeChain } from '../lib/serializeChain'
import { parseChainContent } from '../lib/parseChain'
import { ChainNode, ChainEdge } from '../lib/types'

const nodes: ChainNode[] = [
  { id: 'seedA', kind: 'seed', pos: [0, 0] },
  { id: 'sub', kind: 'subchain', subchain: 'triage', pos: [200, 0] },
]
const edges: ChainEdge[] = [{ fromNode: 'seedA', fromSocket: 'output', toNode: 'sub', toSocket: 'topic' }]

const raw = serializeChain(
  { name: 'Has Subchain', description: '', inputs: [{ name: 'topic', node: 'seedA' }], outputs: [{ name: 'verdict', node: 'w', socket: 'output' }] },
  nodes, edges,
)
const parsed = parseChainContent(raw, 'has-subchain')

const sub = parsed.nodes.find(n => n.id === 'sub')!
assert.strictEqual(sub.kind, 'subchain')
assert.strictEqual(sub.subchain, 'triage')
assert.deepStrictEqual(parsed.inputs, [{ name: 'topic', node: 'seedA' }])
assert.strictEqual(parsed.outputs![0].name, 'verdict')
assert.strictEqual(parsed.outputs![0].node, 'w')

console.log('✅ subchain-roundtrip tests passed')
```

- [ ] **Step 2: Run to verify failure**

Run: `npx tsx tests/subchain-roundtrip.test.ts`
Expected: FAIL — `serializeChain` doesn't accept ports / `parsed.inputs` is undefined / `sub.subchain` undefined.

- [ ] **Step 3: Extend the types.** In `lib/types.ts`:

```ts
export type ChainNodeKind = 'seed' | 'context' | 'agent' | 'gate' | 'branch' | 'decider' | 'loop-start' | 'loop-end' | 'subchain'

export interface ChainPort {
  name: string      // public socket name shown on subchain nodes
  node: string      // inner node this port binds to (seed for inputs; any node for outputs)
  socket?: string   // inner output socket (outputs only); defaults to 'output'
}
```

  Add to `ChainNode` (near `agent?`/`file?`):

```ts
  subchain?: string      // kind === 'subchain' (referenced chain slug)
```

  Add to `ChainDef` (after `edges`):

```ts
  inputs?: ChainPort[]
  outputs?: ChainPort[]
```

- [ ] **Step 4: Serialize the field + ports.** In `lib/serializeChain.ts`:

  Add a `serializeNode` case:

```ts
    case 'subchain':
      if (n.subchain !== undefined) out.subchain = n.subchain
      break
```

  Extend `chainToData` (and the `serializeChain` meta type) to include ports:

```ts
export function chainToData(
  meta: { name: string; description?: string; inputs?: ChainPort[]; outputs?: ChainPort[] },
  nodes: ChainNode[],
  edges: ChainEdge[],
): Record<string, unknown> {
  const data: Record<string, unknown> = {
    name: meta.name,
    description: meta.description ?? '',
    nodes: nodes.map(serializeNode),
    edges: edges.map(serializeEdge),
  }
  if (meta.inputs && meta.inputs.length) data.inputs = meta.inputs
  if (meta.outputs && meta.outputs.length) data.outputs = meta.outputs
  return data
}

export function serializeChain(
  meta: { name: string; description?: string; inputs?: ChainPort[]; outputs?: ChainPort[] },
  nodes: ChainNode[],
  edges: ChainEdge[],
): string {
  return matter.stringify('', chainToData(meta, nodes, edges))
}
```

  Add `ChainPort` to the import from `./types`.

- [ ] **Step 5: Parse the field + ports.** In `lib/parseChain.ts`:

  Add to the node-mapping object (alongside `agent`, `file`):

```ts
        subchain: n.subchain as string | undefined,
```

  In the returned `ChainDef`, parse the ports:

```ts
  const ports = (key: 'inputs' | 'outputs'): ChainPort[] | undefined =>
    Array.isArray(data[key])
      ? (data[key] as Record<string, unknown>[]).map(p => ({
          name: String(p.name), node: String(p.node),
          ...(p.socket !== undefined ? { socket: String(p.socket) } : {}),
        }))
      : undefined

  return { slug, name: data.name, description: data.description ?? '', nodes, edges, filePath: '', isFavorite: false, inputs: ports('inputs'), outputs: ports('outputs') }
```

  Add `ChainPort` to the import from `./types`.

- [ ] **Step 6: Run to verify pass (and no regression)**

Run: `npx tsx tests/subchain-roundtrip.test.ts && npx tsx tests/serialize-chain.test.ts`
Expected: both PASS.

- [ ] **Step 7: Commit**

```bash
git add lib/types.ts lib/serializeChain.ts lib/parseChain.ts tests/subchain-roundtrip.test.ts
git commit -m "feat: subchain kind + chain ChainPort interface with serialize/parse round-trip"
```

---

## Task 2: Subchain sockets, value plumbing, and validation (§2.4)

Derive a subchain node's sockets from the referenced chain's ports; add the per-socket value lookup; validate references and cycles.

**Files:**
- Modify: `lib/nodeSockets.ts`, `lib/resolveNode.ts`, `lib/chainGraph.ts`, `app/api/run/route.ts`
- Test: `tests/nodesockets-subchain.test.ts`, `tests/validate-subchain.test.ts`

**Interfaces:**
- Produces:
  - `inputSocketsOf(node, chain, agents, chains?: ChainDef[]): string[]` / `outputSocketsOf(node, chain, agents, chains?: ChainDef[]): string[]` (new optional 4th arg, default `[]`).
  - `socketValue` handles `kind === 'subchain'` (per-socket) and `kind === 'seed'` (stored-or-seedPrompt).
  - `validateChain(chain, agents, chains?: ChainDef[]): ValidationResult`.

- [ ] **Step 1: Write the failing socket test.** New file `tests/nodesockets-subchain.test.ts`:

```ts
import assert from 'node:assert'
import { inputSocketsOf, outputSocketsOf } from '../lib/nodeSockets'
import { ChainDef, ChainNode } from '../lib/types'

const ref: ChainDef = {
  slug: 'triage', name: 'Triage', description: '', filePath: '',
  nodes: [{ id: 'seedA', kind: 'seed' }, { id: 'w', kind: 'agent', agent: 'x' }],
  edges: [],
  inputs: [{ name: 'topic', node: 'seedA' }],
  outputs: [{ name: 'verdict', node: 'w' }, { name: 'summary', node: 'w', socket: 'summary' }],
}
const host: ChainDef = { slug: 'host', name: 'Host', description: '', filePath: '', nodes: [], edges: [] }
const sub: ChainNode = { id: 'sub', kind: 'subchain', subchain: 'triage' }

assert.deepStrictEqual(inputSocketsOf(sub, host, [], [ref]), ['topic'])
assert.deepStrictEqual(outputSocketsOf(sub, host, [], [ref]), ['verdict', 'summary'])

// fallback when the referenced chain declares nothing
const bare: ChainDef = { slug: 'bare', name: 'Bare', description: '', filePath: '', nodes: [], edges: [] }
const sub2: ChainNode = { id: 's2', kind: 'subchain', subchain: 'bare' }
assert.deepStrictEqual(inputSocketsOf(sub2, host, [], [bare]), [])
assert.deepStrictEqual(outputSocketsOf(sub2, host, [], [bare]), ['output'])

console.log('✅ nodesockets-subchain tests passed')
```

- [ ] **Step 2: Run to verify failure**

Run: `npx tsx tests/nodesockets-subchain.test.ts`
Expected: FAIL — `inputSocketsOf`/`outputSocketsOf` don't take a 4th arg / return `[]`.

- [ ] **Step 3: Implement subchain sockets.** In `lib/nodeSockets.ts`, add the `chains` param to both functions and a subchain branch:

```ts
export function inputSocketsOf(node: ChainNode, chain: ChainDef, agents: AgentDef[], chains: ChainDef[] = []): string[] {
  if (node.kind === 'subchain') {
    const ref = chains.find(c => c.slug === node.subchain)
    return (ref?.inputs ?? []).map(p => p.name)
  }
  // …existing branches unchanged…
}

export function outputSocketsOf(node: ChainNode, chain: ChainDef, agents: AgentDef[], chains: ChainDef[] = []): string[] {
  if (node.kind === 'subchain') {
    const ref = chains.find(c => c.slug === node.subchain)
    const outs = (ref?.outputs ?? []).map(p => p.name)
    return outs.length ? outs : ['output']
  }
  // …existing branches unchanged…
}
```

- [ ] **Step 4: Add the value plumbing.** In `lib/resolveNode.ts`, in `socketValue`:

  Add a `subchain` branch (alongside the loop-start/loop-end branch — same per-socket pattern):

```ts
  if (src.kind === 'subchain') {
    const o = nodeOutputs.get(`${src.id}::${slugify(socket)}`)
    return o ? o.output : ''
  }
```

  And make the `seed` branch prefer a stored (injected) value:

```ts
  if (src.kind === 'seed') {
    const o = nodeOutputs.get(src.id)
    return o ? o.output : seedPrompt
  }
```

- [ ] **Step 5: Write the failing validation test.** New file `tests/validate-subchain.test.ts`:

```ts
import assert from 'node:assert'
import { validateChain } from '../lib/chainGraph'
import { ChainDef } from '../lib/types'

const mk = (slug: string, refs: string[], outputs = [{ name: 'out', node: 'seed' }]): ChainDef => ({
  slug, name: slug, description: '', filePath: '',
  nodes: [{ id: 'seed', kind: 'seed' }, ...refs.map((r, i) => ({ id: `sub${i}`, kind: 'subchain' as const, subchain: r }))],
  edges: [], outputs,
})

// unknown reference
const u = mk('a', ['ghost'])
assert.ok(validateChain(u, [], [u]).errors.some(e => /unknown chain|not found/i.test(e)))

// self-reference cycle
const s = mk('a', ['a'])
assert.ok(validateChain(s, [], [s]).errors.some(e => /cycle/i.test(e)))

// mutual A<->B cycle
const A = mk('a', ['b']); const B = mk('b', ['a'])
assert.ok(validateChain(A, [], [A, B]).errors.some(e => /cycle/i.test(e)))

// referenced chain with no declared outputs -> a warning-level issue mentioning outputs
const P = mk('p', ['q']); const Q: ChainDef = { ...mk('q', []), outputs: [] }
assert.ok(validateChain(P, [], [P, Q]).errors.some(e => /no .*outputs|nothing to wire/i.test(e)))

// valid acyclic reference with outputs passes the subchain checks
const okP = mk('p', ['q']); const okQ = mk('q', [])
assert.ok(!validateChain(okP, [], [okP, okQ]).errors.some(e => /cycle|unknown chain/i.test(e)))

console.log('✅ validate-subchain tests passed')
```

- [ ] **Step 6: Implement validation.** In `lib/chainGraph.ts`:

  Signature + thread `chains` to the socket calls (the two `inputSocketsOf`/`outputSocketsOf` calls inside `validateChain`):

```ts
export function validateChain(chain: ChainDef, agents: AgentDef[], chains: ChainDef[] = []): ValidationResult {
```

```ts
    if (!outputSocketsOf(src, chain, agents, chains).includes(slugify(e.fromSocket))) {
```

```ts
    if (acceptsInputs(dst) && !inputSocketsOf(dst, chain, agents, chains).includes(e.toSocket)) add(`Edge "${e.toNode}.${e.toSocket}": no such input slot`, { edge: e })
```

  Add `'subchain'` to both kind sets:

```ts
  const acceptsInputs = (n: ChainNode): boolean =>
    n.kind === 'agent' || n.kind === 'decider' || n.kind === 'gate' || n.kind === 'branch' ||
    n.kind === 'loop-start' || n.kind === 'loop-end' || n.kind === 'subchain'

  const allowedKinds = new Set<string>(['seed', 'context', 'agent', 'gate', 'branch', 'decider', 'loop-start', 'loop-end', 'subchain'])
```

  Call the new check before the final `return`:

```ts
  validateSubchains(chain, chains, add)
```

  Add the function at the bottom of the file:

```ts
function validateSubchains(
  chain: ChainDef,
  chains: ChainDef[],
  add: (message: string, ref?: Omit<ValidationIssue, 'message' | 'severity'>) => void,
) {
  const bySlug = new Map(chains.map(c => [c.slug, c]))
  const refsOf = (c: ChainDef): string[] =>
    c.nodes.filter(n => n.kind === 'subchain' && n.subchain).map(n => n.subchain as string)

  for (const n of chain.nodes) {
    if (n.kind !== 'subchain') continue
    if (!n.subchain) { add(`Node "${n.id}": subchain has no chain reference`, { nodeId: n.id }); continue }
    const ref = bySlug.get(n.subchain)
    if (!ref && n.subchain !== chain.slug) { add(`Node "${n.id}": references unknown chain "${n.subchain}"`, { nodeId: n.id }); continue }
    const target = n.subchain === chain.slug ? chain : ref
    if (target && (!target.outputs || target.outputs.length === 0)) {
      add(`Node "${n.id}": referenced chain "${n.subchain}" declares no outputs (nothing to wire)`, { nodeId: n.id })
    }
  }

  const reaches = (start: ChainDef, target: string, seen: Set<string>): boolean => {
    for (const r of refsOf(start)) {
      if (r === target) return true
      const next = bySlug.get(r)
      if (next && !seen.has(r)) { seen.add(r); if (reaches(next, target, seen)) return true }
    }
    return false
  }
  if (reaches(chain, chain.slug, new Set())) add(`Chain "${chain.slug}" has a subchain reference cycle`, {})
}
```

- [ ] **Step 7: Pass `chains` from the run route.** In `app/api/run/route.ts`:

```ts
  const validation = validateChain(chain, agents, chains)
```

- [ ] **Step 8: Run to verify pass (and no regression)**

Run: `npx tsx tests/nodesockets-subchain.test.ts && npx tsx tests/validate-subchain.test.ts && npx tsx tests/validate-issues.test.ts && npx tsx tests/resolve-node.test.ts`
Expected: all PASS (the new args default to `[]`; the `seed` tweak still returns `seedPrompt` when no entry exists).

- [ ] **Step 9: Commit**

```bash
git add lib/nodeSockets.ts lib/resolveNode.ts lib/chainGraph.ts app/api/run/route.ts tests/nodesockets-subchain.test.ts tests/validate-subchain.test.ts
git commit -m "feat: subchain sockets from chain ports + per-socket value lookup + validation"
```

---

## Task 3: Subchain executor recursion — multi-input / multi-output (§2.4)

Inject wired inputs into the inner chain's seeds, run it recursively, and store each declared output under a per-socket key.

**Files:**
- Modify: `lib/executor.ts`, `app/api/run/route.ts`
- Test: `tests/executor-subchain.test.ts`

**Interfaces:**
- Produces: `runChainGraph(chain, agents, skills, seedPrompt, workspacePath, callbacks, runFn?, startOutputs?, chains?: ChainDef[], depth?: number)`.

- [ ] **Step 1: Write the failing executor test.** New file `tests/executor-subchain.test.ts`:

```ts
import assert from 'node:assert'
import { runChainGraph } from '../lib/executor'
import { AgentDef, AgentOutput, ChainDef } from '../lib/types'

const agent = (slug: string, systemPrompt: string): AgentDef => ({
  slug, name: slug, model: 'gpt-4o', description: '', skills: [], context: [],
  input_from: 'user', output_format: 'markdown', outputs: [], inputs: [], systemPrompt, filePath: '',
})
// the fake runner echoes the *resolved* system prompt, so injected input values show up in the output
const fakeRun = async (a: AgentDef, systemPrompt: string): Promise<AgentOutput> => ({
  agentName: a.name, systemPrompt, input: '', output: systemPrompt,
  tokensIn: 0, tokensOut: 0, costUsd: 0, latencyMs: 0, model: '', timestamp: new Date().toISOString(), status: 'success',
})
const noop = { onStart() {}, onToken() {}, onDone() {} }

// inner: two seeds feed two agents; the chain exposes two named outputs
const inner: ChainDef = {
  slug: 'inner', name: 'Inner', description: '', filePath: '',
  nodes: [
    { id: 'seedA', kind: 'seed' }, { id: 'seedB', kind: 'seed' },
    { id: 'w', kind: 'agent', agent: 'w' }, { id: 'v', kind: 'agent', agent: 'v' },
  ],
  edges: [
    { fromNode: 'seedA', fromSocket: 'output', toNode: 'w', toSocket: 'x' },
    { fromNode: 'seedB', fromSocket: 'output', toNode: 'v', toSocket: 'y' },
  ],
  inputs: [{ name: 'x', node: 'seedA' }, { name: 'y', node: 'seedB' }],
  outputs: [{ name: 'rw', node: 'w' }, { name: 'rv', node: 'v' }],
}
const parent: ChainDef = {
  slug: 'parent', name: 'Parent', description: '', filePath: '',
  nodes: [{ id: 'seed', kind: 'seed' }, { id: 'sub', kind: 'subchain', subchain: 'inner' }],
  edges: [
    { fromNode: 'seed', fromSocket: 'output', toNode: 'sub', toSocket: 'x' },
    { fromNode: 'seed', fromSocket: 'output', toNode: 'sub', toSocket: 'y' },
  ],
}
const agents = [agent('w', 'X={x}'), agent('v', 'Y={y}')]

const results = await runChainGraph(parent, agents, [], 'PARENT', '/tmp', noop, fakeRun, [], [inner])
// each declared output landed in per-socket storage; injection filled the inner slots
const rw = results.find(r => r.nodeId === 'sub::rw')
const rv = results.find(r => r.nodeId === 'sub::rv')
assert.ok(rw && rw.output.includes('PARENT'), 'output rw carries the injected input value')
assert.ok(rv && rv.output.includes('PARENT'), 'output rv carries the injected input value')
assert.ok(!rw!.output.includes('not wired'), 'inner slot x was injected, not left unwired')

// depth guard
await assert.rejects(() => runChainGraph(parent, agents, [], 'PARENT', '/tmp', noop, fakeRun, [], [inner], 99), /too deep/i)

console.log('✅ executor-subchain tests passed')
```

- [ ] **Step 2: Run to verify failure**

Run: `npx tsx tests/executor-subchain.test.ts`
Expected: FAIL — no `sub::rw`/`sub::rv` records; subchain kind not handled.

- [ ] **Step 3: Implement recursion.** In `lib/executor.ts`:

  Extend the import from `./graph` to include `extractSection`:

```ts
import { slugify, extractSection } from './graph'
```

  Extend the signature + add the depth guard at the top of the function:

```ts
export async function runChainGraph(
  chain: ChainDef,
  agents: AgentDef[],
  skills: SkillDef[],
  seedPrompt: string,
  workspacePath: string,
  callbacks: RunCallbacks,
  runFn: typeof runAgent = runAgent,
  startOutputs: AgentOutput[] = [],
  chains: ChainDef[] = [],
  depth = 0,
): Promise<AgentOutput[]> {
  const MAX_SUBCHAIN_DEPTH = 10
  if (depth > MAX_SUBCHAIN_DEPTH) throw new Error('subchain recursion too deep')
```

  In `usedSlots`, gate the subchain by its declared input names:

```ts
    if (node.kind === 'subchain') {
      const ref = chains.find(c => c.slug === node.subchain)
      return (ref?.inputs ?? []).map(p => p.name)
    }
```

  Generalize `inValue` into a reusable `slotValue` (the existing `inValue` reads slot `'in'`):

```ts
  const slotValue = (nodeId: string, slot: string): string => {
    const idx = liveEdgeForSlot(nodeId, slot)
    if (idx === undefined) return ''
    const e = chain.edges[idx]
    const src = nodeById.get(e.fromNode)
    return src ? socketValue(src, e.fromSocket, nodeOutputs, seedPrompt, readContext) : ''
  }
  const inValue = (nodeId: string): string => slotValue(nodeId, 'in')
```

  In the main topo loop's kind dispatch, add a `subchain` branch (after the `branch` branch):

```ts
    } else if (node.kind === 'subchain') {
      const ref = chains.find(c => c.slug === node.subchain)
      if (!ref) {
        const rec = controlOutput(nodeId, `subchain: ${node.subchain ?? '?'} (missing)`, '', 'error')
        nodeOutputs.set(nodeId, rec); results.push(rec); callbacks.onDone(nodeId, rec)
      } else {
        callbacks.onStart(nodeId, ref.name)
        // inject each declared input value into the matching inner seed node
        const innerStart: AgentOutput[] = (ref.inputs ?? []).map(p =>
          controlOutput(p.node, p.name, slotValue(nodeId, p.name), 'success'))
        const innerResults = await runChainGraph(
          ref, agents, skills, seedPrompt, workspacePath,
          { onStart: () => {}, onToken: () => {}, onDone: () => {} },
          runFn, innerStart, chains, depth + 1,
        )
        // map each declared output to per-socket storage on this node
        const byNode = new Map<string, AgentOutput>()
        for (const r of innerResults) if (r.nodeId) byNode.set(r.nodeId, r)
        const outMap = new Map<string, string>()
        for (const p of ref.outputs ?? []) {
          const r = byNode.get(p.node)
          const val = r ? (slugify(p.socket ?? 'output') === 'output' ? r.output : extractSection(r.output, p.socket!)) : ''
          outMap.set(p.name, val)
        }
        setStateSockets(nodeId, outMap)   // stores `${nodeId}::${slug(name)}` records + pushes to results
        const statusRec = controlOutput(nodeId, ref.name, '', 'success')
        nodeOutputs.set(nodeId, statusRec); results.push(statusRec); callbacks.onDone(nodeId, statusRec)
        markOut(nodeId, () => true)
      }
    }
```

  > Reuses existing helpers `controlOutput`, `slotValue`, `setStateSockets`, `markOut`, `socketValue`, `nodeOutputs`, `results`. The inner run uses no-op callbacks (its nodes don't stream into the parent canvas); per-input injection rides the existing `startOutputs` replay, and the `seed` tweak from Task 2 makes those injected values readable inside the inner run.

- [ ] **Step 4: Pass `chains` from the run route.** In `app/api/run/route.ts`, add `chains` as the 9th argument to the `runChainGraph` call:

```ts
        const results = await runChainGraph(
          theChain, agents, skills, seedPrompt, wp,
          { /* …existing callbacks… */ },
          undefined,
          (branchOutputs as AgentOutput[]) ?? [],
          chains,
        )
```

- [ ] **Step 5: Run to verify pass (and no regression)**

Run: `npx tsx tests/executor-subchain.test.ts && npx tsx tests/executor-loop.test.ts`
Expected: both PASS.

- [ ] **Step 6: Commit**

```bash
git add lib/executor.ts app/api/run/route.ts tests/executor-subchain.test.ts
git commit -m "feat: executor runs subchains recursively — multi-input injection + multi-output per-socket storage"
```

---

## Task 4: Chain interface authoring panel (§2.4)

Let the user declare a chain's public inputs/outputs in the editor; persist them to frontmatter.

**Files:**
- Create: `components/editor/InterfacePanel.tsx`
- Modify: `components/editor/ChainEditor.tsx`

**Interfaces:**
- Consumes: `ChainPort`, `ChainNode`.
- Produces: `InterfacePanel` (default export) with props `{ nodes: ChainNode[]; inputs: ChainPort[]; outputs: ChainPort[]; onChange: (iface: { inputs: ChainPort[]; outputs: ChainPort[] }) => void }`.

- [ ] **Step 1: Create the panel.** New file `components/editor/InterfacePanel.tsx`:

```tsx
'use client'
import React from 'react'
import type { ChainNode, ChainPort } from '@/lib/types'
import { Plus, X } from 'lucide-react'

export default function InterfacePanel({ nodes, inputs, outputs, onChange }: {
  nodes: ChainNode[]
  inputs: ChainPort[]
  outputs: ChainPort[]
  onChange: (iface: { inputs: ChainPort[]; outputs: ChainPort[] }) => void
}) {
  const seeds = nodes.filter(n => n.kind === 'seed')
  const set = (next: Partial<{ inputs: ChainPort[]; outputs: ChainPort[] }>) =>
    onChange({ inputs, outputs, ...next })

  const Row = ({ port, i, kind }: { port: ChainPort; i: number; kind: 'inputs' | 'outputs' }) => {
    const list = kind === 'inputs' ? inputs : outputs
    const update = (patch: Partial<ChainPort>) => {
      const copy = list.map((p, j) => (j === i ? { ...p, ...patch } : p))
      set({ [kind]: copy } as any)
    }
    const remove = () => set({ [kind]: list.filter((_, j) => j !== i) } as any)
    return (
      <div className="flex items-center gap-1.5 mb-1">
        <input
          value={port.name}
          onChange={e => update({ name: e.target.value })}
          placeholder="socket name"
          className="w-24 text-[11px] border border-zinc-200 rounded px-1.5 py-0.5"
        />
        <span className="text-[10px] text-zinc-400">→</span>
        <select
          value={port.node}
          onChange={e => update({ node: e.target.value })}
          className="flex-1 text-[11px] border border-zinc-200 rounded px-1.5 py-0.5"
        >
          <option value="">— node —</option>
          {(kind === 'inputs' ? seeds : nodes).map(n => <option key={n.id} value={n.id}>{n.id}</option>)}
        </select>
        <button onClick={remove} className="text-zinc-300 hover:text-red-500"><X size={12} /></button>
      </div>
    )
  }

  return (
    <div className="border-t border-zinc-200 bg-white px-4 py-2 text-[11px]">
      <div className="grid grid-cols-2 gap-4">
        <div>
          <div className="flex items-center justify-between mb-1">
            <span className="text-[9px] font-bold text-zinc-400 uppercase tracking-widest">Inputs</span>
            <button onClick={() => set({ inputs: [...inputs, { name: '', node: seeds[0]?.id ?? '' }] })} className="text-zinc-400 hover:text-zinc-700"><Plus size={12} /></button>
          </div>
          {inputs.map((p, i) => <Row key={i} port={p} i={i} kind="inputs" />)}
        </div>
        <div>
          <div className="flex items-center justify-between mb-1">
            <span className="text-[9px] font-bold text-zinc-400 uppercase tracking-widest">Outputs</span>
            <button onClick={() => set({ outputs: [...outputs, { name: '', node: '' }] })} className="text-zinc-400 hover:text-zinc-700"><Plus size={12} /></button>
          </div>
          {outputs.map((p, i) => <Row key={i} port={p} i={i} kind="outputs" />)}
        </div>
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Hold the interface in `ChainEditor` and persist it.** In `components/editor/ChainEditor.tsx`:

  Add state seeded from the chain, and include it in the serialize effect:

```ts
  const [iface, setIface] = useState<{ inputs: ChainPort[]; outputs: ChainPort[] }>(() => ({
    inputs: initialChain.inputs ?? [],
    outputs: initialChain.outputs ?? [],
  }))
```

  Update the serialize→autosave effect to include the ports (so they round-trip to frontmatter):

```ts
  useEffect(() => {
    setContent(serializeChain({ name: meta.name, description: meta.description, inputs: iface.inputs, outputs: iface.outputs }, nodes, edges))
  }, [meta, nodes, edges, iface, setContent])
```

  (Also include `iface` when serializing inside the inline-run `streamInline`/`run` body so a run reflects the live interface.)

  Render the panel (e.g. between `ValidationPanel` and `NodePreview`):

```tsx
      <InterfacePanel nodes={nodes} inputs={iface.inputs} outputs={iface.outputs} onChange={setIface} />
```

  Add imports: `InterfacePanel` from `./InterfacePanel`, `ChainPort` from `@/lib/types`.

- [ ] **Step 3: Typecheck + manual verification**

Run: `npx tsc --noEmit` (expect no errors), then `npm run dev`, open a chain with a seed and an agent:
- The **Inputs/Outputs** panel appears; add an input (name it, bound to the seed) and an output (name it, bound to the agent node).
- The values persist (autosave → reload shows them; the chain `.md` frontmatter now has `inputs:`/`outputs:`).

- [ ] **Step 4: Commit**

```bash
git add components/editor/InterfacePanel.tsx components/editor/ChainEditor.tsx
git commit -m "feat: chain public-interface authoring panel (declare inputs/outputs)"
```

---

## Task 5: Subchain node UI + palette + threading chains (§2.4)

The node itself: a chain picker + the inherited interface sockets, wired into validation and runs.

**Files:**
- Create: `components/editor/nodes/SubchainNode.tsx`
- Modify: `components/editor/ChainCanvas.tsx`, `components/editor/NodePalette.tsx`, `components/editor/nodeData.ts`, `components/editor/ChainEditor.tsx`, `app/workspace/page.tsx`

**Interfaces:**
- Consumes: `EditorNodeData` (+ new `chains`), `inputSocketsOf`/`outputSocketsOf` (Task 2).
- Produces: `EditorNodeData.chains: { slug: string; name: string }[]`; `ChainEditor` prop `chains: ChainDef[]`.

- [ ] **Step 1: Skim `.agents/skills/xyflow12.md`** (custom node typing, named imports, no-mutation), and confirm passing `chains` as a prop from the client `page.tsx` down to `ChainEditor` is fine (it already passes `agents`/`contextFiles`).

- [ ] **Step 2: Add `chains` to `EditorNodeData`.** In `components/editor/nodeData.ts`, add inside the interface:

```ts
  chains: { slug: string; name: string }[]
```

- [ ] **Step 3: Create the node.** New file `components/editor/nodes/SubchainNode.tsx` — renders the chain picker plus one handle per inherited socket (`data.inputs`/`data.outputs`, which Task 2's socket fns derive from the referenced chain's ports):

```tsx
'use client'
import React, { memo } from 'react'
import { Handle, Position, type NodeProps, type Node } from '@xyflow/react'
import type { EditorNodeData } from '../nodeData'
import { statusDotClass } from '../nodeData'

function SubchainNode({ data, selected }: NodeProps<Node<EditorNodeData>>) {
  const { node, inputs, outputs, run, issues } = data
  return (
    <div className={`relative rounded-lg shadow-md border-2 min-w-[240px] bg-white ${issues.length ? 'border-red-400' : selected ? 'border-zinc-900 ring-4 ring-zinc-900/5' : 'border-indigo-300'}`}>
      <div className="px-4 py-2 border-b border-zinc-100 bg-indigo-50/50 rounded-t-lg flex items-center gap-2">
        <div className={`w-2 h-2 rounded-full ${statusDotClass(run)}`} />
        <span className="text-[9px] font-bold text-indigo-400 uppercase tracking-widest">Subchain</span>
        {node.subchain && (
          <a href={`/workspace?type=chain&slug=${node.subchain}`} className="nodrag ml-auto text-[9px] font-bold text-zinc-400 hover:text-zinc-900">Open chain →</a>
        )}
      </div>
      <div className="px-4 py-2">
        <select
          value={node.subchain ?? ''}
          onChange={e => data.onChange({ subchain: e.target.value })}
          className="w-full text-xs border border-zinc-200 rounded px-2 py-1 nodrag mb-2"
        >
          <option value="">— pick a chain —</option>
          {data.chains.map(c => <option key={c.slug} value={c.slug}>{c.name}</option>)}
        </select>
        <div className="flex justify-between gap-4 text-[9px] font-mono text-zinc-400">
          <div className="flex flex-col gap-1.5">
            {inputs.map(s => (
              <div key={s} className="relative pl-3 flex items-center h-5">
                <Handle type="target" id={s} position={Position.Left} style={{ left: -16, top: '50%', transform: 'translateY(-50%)' }} className="w-2.5 h-2.5 border-2 border-white !bg-zinc-400" />
                <span className="truncate max-w-[100px]" title={s}>{s}</span>
              </div>
            ))}
          </div>
          <div className="flex flex-col gap-1.5 text-right">
            {outputs.map(s => (
              <div key={s} className="relative pr-3 flex items-center justify-end h-5">
                <span className="truncate max-w-[100px]" title={`.${s}`}>.{s}</span>
                <Handle type="source" id={s} position={Position.Right} style={{ right: -16, top: '50%', transform: 'translateY(-50%)' }} className="w-2.5 h-2.5 border-2 border-white !bg-zinc-900" />
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}
export default memo(SubchainNode)
```

- [ ] **Step 4: Register + palette.** In `components/editor/ChainCanvas.tsx`:

```tsx
import SubchainNode from './nodes/SubchainNode'
```

```ts
  gate: GateNode, branch: BranchNode, 'loop-start': LoopStartNode, 'loop-end': LoopEndNode,
  subchain: SubchainNode,
  zoneFrame: ZoneFrame,
```

  In `components/editor/NodePalette.tsx`:

```ts
  { kind: 'subchain', label: 'Subchain', group: 'Composite' },
```

```ts
const GROUPS = ['Sources', 'Agents', 'Control flow', 'Loop', 'Composite']
```

- [ ] **Step 5: Thread `chains` through the editor.** In `components/editor/ChainEditor.tsx`:

  Add the prop:

```ts
export default function ChainEditor({ slug, initialChain, agents, contextFiles, refetchAgents, initialSeedPrompt, chains }: {
  slug: string
  initialChain: ChainDef
  agents: AgentDef[]
  contextFiles: { slug: string; name: string }[]
  refetchAgents?: () => void
  initialSeedPrompt?: string
  chains: ChainDef[]
}) {
```

  Pass `chains` to validation and to the socket calls in `buildData`:

```ts
  const validation = useMemo(() => validateChain(chain, agents, chains), [chain, agents, chains])
```

```ts
    inputs: inputSocketsOf(node, chain, agents, chains),
    outputs: outputSocketsOf(node, chain, agents, chains),
    chains: chains.map(c => ({ slug: c.slug, name: c.name })),
```

  (Add `chains` to `buildData`'s dependency array.)

- [ ] **Step 6: Provide `chains` from the page.** In `app/workspace/page.tsx`:

```ts
  const [editorChains, setEditorChains] = useState<ChainDef[]>([])
```

  In `refetchEditorData` (Group A introduced it), also set chains:

```ts
      .then(w => { setEditorAgents(w.agents ?? []); setEditorContext(w.context ?? []); setEditorChains(w.chains ?? []) })
```

  Pass it to the editor JSX:

```tsx
                      chains={editorChains}
```

- [ ] **Step 7: Typecheck + manual verification**

Run: `npx tsc --noEmit` (expect no errors), then `npm run dev`:
- In chain **Triage**, declare interface ports (Task 4): input `topic` → its seed, output `verdict` → an agent node.
- In chain **Host**, add a **Composite → Subchain** node and pick **Triage** — the node shows a `topic` input handle and a `verdict` output handle. Wire upstream → `topic` and `verdict` → downstream.
- Run **Host**: the upstream value is injected into Triage's seed; `verdict` carries Triage's chosen output to the downstream node.
- Referencing a chain that (transitively) references Host shows a "reference cycle" issue; referencing a chain with no declared outputs shows the "nothing to wire" issue.

- [ ] **Step 8: Commit**

```bash
git add components/editor/nodes/SubchainNode.tsx components/editor/ChainCanvas.tsx components/editor/NodePalette.tsx components/editor/nodeData.ts components/editor/ChainEditor.tsx app/workspace/page.tsx
git commit -m "feat: subchain node UI with inherited interface sockets + chain wiring"
```

---

## Task 6: External-edit reconciliation logic (§2.8)

The pure three-way decision: ignore our own write, adopt a clean external change, or flag a conflict.

**Files:**
- Create: `lib/syncReconcile.ts`
- Test: `tests/sync-reconcile.test.ts`

**Interfaces:**
- Produces: `type Reconciliation = 'ignore-echo' | 'adopt' | 'conflict'`; `reconcileExternalEdit(args: { local: string; lastSaved: string; incoming: string }): Reconciliation`.

- [ ] **Step 1: Write the failing tests.** New file `tests/sync-reconcile.test.ts`:

```ts
import assert from 'node:assert'
import { reconcileExternalEdit } from '../lib/syncReconcile'

assert.strictEqual(reconcileExternalEdit({ local: 'A', lastSaved: 'A', incoming: 'A' }), 'ignore-echo')
assert.strictEqual(reconcileExternalEdit({ local: 'A', lastSaved: 'A', incoming: 'B' }), 'adopt')
assert.strictEqual(reconcileExternalEdit({ local: 'C', lastSaved: 'A', incoming: 'B' }), 'conflict')
assert.strictEqual(reconcileExternalEdit({ local: 'C', lastSaved: 'A', incoming: 'A' }), 'ignore-echo')

console.log('✅ sync-reconcile tests passed')
```

- [ ] **Step 2: Run to verify failure**

Run: `npx tsx tests/sync-reconcile.test.ts`
Expected: FAIL — cannot find module `../lib/syncReconcile`.

- [ ] **Step 3: Implement.** New file `lib/syncReconcile.ts`:

```ts
export type Reconciliation = 'ignore-echo' | 'adopt' | 'conflict'

// Decide what to do when the entity file changes on disk while the editor is open.
export function reconcileExternalEdit(args: { local: string; lastSaved: string; incoming: string }): Reconciliation {
  const { local, lastSaved, incoming } = args
  if (incoming === lastSaved) return 'ignore-echo'   // our own write (or no real change)
  if (local === lastSaved) return 'adopt'            // disk moved, we have no unsaved edits
  return 'conflict'                                  // disk moved AND we have unsaved edits
}
```

- [ ] **Step 4: Run to verify pass**

Run: `npx tsx tests/sync-reconcile.test.ts`
Expected: PASS — `✅ sync-reconcile tests passed`.

- [ ] **Step 5: Commit**

```bash
git add lib/syncReconcile.ts tests/sync-reconcile.test.ts
git commit -m "feat: reconcileExternalEdit — pure ignore-echo/adopt/conflict decision"
```

---

## Task 7: File-watch route + hook + editor integration (§2.8)

Watch the entity file, stream changes, and apply the reconciliation in the editor.

**Files:**
- Create: `app/api/watch/route.ts`, `hooks/useFileWatch.ts`
- Modify: `hooks/useAutoSave.ts`, `components/editor/ChainEditor.tsx`

**Interfaces:**
- Consumes: `reconcileExternalEdit` (Task 6), `parseChainContent`, `seedPositions`, `chokidar`, `resolveEntityPath`.
- Produces: `GET /api/watch?type&slug` (SSE, emits `{ type: 'change', raw }`); `useFileWatch(type, slug): string | null`; `useAutoSave` adds `getLastSaved: () => string`.

- [ ] **Step 1: Read `.agents/skills/nextjs16.md`** (route handlers, caching, runtime), then `node_modules/next/dist/docs/` for gaps — confirm `export const runtime = 'nodejs'`, `export const dynamic = 'force-dynamic'`, and `ReadableStream` SSE responses for this version. `req.nextUrl.searchParams` is synchronous (no `await`).

- [ ] **Step 2: Create the watch route.** New file `app/api/watch/route.ts`:

```ts
import { NextRequest } from 'next/server'
import { resolveEntityPath, isValidEntityType } from '@/lib/fs/workspace'
import chokidar from 'chokidar'
import fs from 'fs'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  const type = req.nextUrl.searchParams.get('type') ?? ''
  const slug = req.nextUrl.searchParams.get('slug') ?? ''
  if (!isValidEntityType(type) || !slug) return new Response('Bad request', { status: 400 })

  const filePath = resolveEntityPath(type, slug)
  const encoder = new TextEncoder()

  const stream = new ReadableStream({
    start(controller) {
      const send = (data: object) => controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`))
      const watcher = chokidar.watch(filePath, { ignoreInitial: true, awaitWriteFinish: { stabilityThreshold: 150, pollInterval: 50 } })
      watcher.on('change', () => {
        try { send({ type: 'change', raw: fs.readFileSync(filePath, 'utf-8') }) } catch {}
      })
      req.signal.addEventListener('abort', () => { watcher.close(); try { controller.close() } catch {} })
    },
  })

  return new Response(stream, {
    headers: { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' },
  })
}
```

- [ ] **Step 3: Create the hook.** New file `hooks/useFileWatch.ts`:

```ts
'use client'
import { useEffect, useState } from 'react'

// Subscribe to on-disk changes for an entity; returns the latest raw file content (or null).
export function useFileWatch(type: string | null, slug: string | null): string | null {
  const [incoming, setIncoming] = useState<string | null>(null)
  useEffect(() => {
    if (!type || !slug) return
    const es = new EventSource(`/api/watch?type=${type}&slug=${slug}`)
    es.onmessage = (e) => {
      try {
        const data = JSON.parse(e.data)
        if (data.type === 'change' && typeof data.raw === 'string') setIncoming(data.raw)
      } catch {}
    }
    return () => es.close()
  }, [type, slug])
  return incoming
}
```

- [ ] **Step 4: Expose `getLastSaved` from `useAutoSave`.** In `hooks/useAutoSave.ts`, add to the returned object:

```ts
    getLastSaved: () => lastSavedContentRef.current,
```

- [ ] **Step 5: Integrate in `ChainEditor`.** In `components/editor/ChainEditor.tsx`:

  Pull `content` and `getLastSaved` from `useAutoSave`, subscribe, reconcile, and (when adopting/reloading) restore both graph and interface:

```ts
  const { setContent, status, content, getLastSaved } = useAutoSave('chain', slug, initialMarkdown)
  const incoming = useFileWatch('chain', slug)
  const [conflict, setConflict] = useState<string | null>(null)

  const adopt = useCallback((raw: string) => {
    const parsed = parseChainContent(raw, slug)
    dispatch({ type: 'setGraph', nodes: seedPositions(parsed.nodes, parsed.edges), edges: parsed.edges })
    setIface({ inputs: parsed.inputs ?? [], outputs: parsed.outputs ?? [] })
  }, [slug])

  useEffect(() => {
    if (incoming == null) return
    const decision = reconcileExternalEdit({ local: content, lastSaved: getLastSaved(), incoming })
    if (decision === 'adopt') adopt(incoming)
    else if (decision === 'conflict') setConflict(incoming)
  }, [incoming]) // eslint-disable-line react-hooks/exhaustive-deps
```

  Add imports: `useFileWatch` from `@/hooks/useFileWatch`, `reconcileExternalEdit` from `@/lib/syncReconcile`, and ensure `parseChainContent` from `@/lib/parseChain` is imported.

  Render a non-destructive banner when `conflict` is set (near the `runError` banner):

```tsx
      {conflict && (
        <div className="px-4 py-1.5 text-[11px] text-amber-700 bg-amber-50 border-b border-amber-100 flex items-center gap-3">
          <span>This chain changed on disk.</span>
          <button className="font-bold underline" onClick={() => { adopt(conflict); setConflict(null) }}>Reload from disk</button>
          <button className="font-bold underline" onClick={() => setConflict(null)}>Keep my version</button>
        </div>
      )}
```

- [ ] **Step 6: Manual verification**

Run: `npm run dev`, open a chain in Graph mode:
- With no unsaved edits, change the chain's `.md` on disk → the canvas (and interface ports) update silently (adopt).
- Make an unsaved canvas edit, then change the file on disk → the amber **conflict banner** appears; **Reload from disk** replaces canvas+interface with disk; **Keep my version** dismisses and the next autosave overwrites disk.
- Normal editing does **not** loop or flicker (your own autosave write is ignored as an echo).

- [ ] **Step 7: Commit**

```bash
git add app/api/watch/route.ts hooks/useFileWatch.ts hooks/useAutoSave.ts components/editor/ChainEditor.tsx
git commit -m "feat: external-edit file-watch sync with adopt/conflict reconciliation"
```

---

## Self-Review

**Spec coverage (Group C of the design doc):**
- §2.4 data model + chain ports + round-trip → Task 1. ✓
- §2.4 sockets-from-ports + per-socket `socketValue` + seed injection + validation (unknown/cycle/no-outputs) → Task 2. ✓
- §2.4 executor recursion: **multi-input injection** into inner seeds + **multi-output** per-socket storage + depth guard → Task 3. ✓
- §2.4 interface authoring (declare ports once on the chain) → Task 4. ✓
- §2.4 subchain node with inherited interface sockets + wiring → Task 5. ✓
- §2.8 reconciliation logic → Task 6; watch route + hook + echo suppression + adopt/conflict banner (now restoring interface too) → Task 7. ✓

**Placeholder scan:** No TBD/TODO; pure modules ship complete code + tests; UI/route steps list concrete expected outcomes and gate on reading the project skills. ✓

**Type consistency:** `ChainPort`, `ChainDef.inputs/outputs`, `ChainNode.subchain`; `inputSocketsOf`/`outputSocketsOf(…, chains?)`; `socketValue` subchain/seed; `validateChain(…, chains?)`; `runChainGraph(…, chains?, depth?)`; `chainToData`/`serializeChain` meta with ports; `EditorNodeData.chains`; `ChainEditor` prop `chains: ChainDef[]`; `InterfacePanel` props; `Reconciliation`/`reconcileExternalEdit`; `useFileWatch`; `useAutoSave().getLastSaved`; the editor's `iface` state + `adopt()` — defined once and consumed by name. The executor's subchain branch reuses existing helpers (`controlOutput`, `slotValue`, `setStateSockets`, `markOut`, `socketValue`); the `seed` `socketValue` tweak is what makes injected inner-input values readable. ✓

**Sequencing:** Tasks 4–5 depend on Tasks 1–3 (ports, sockets, executor). Keep order. The editor's serialize effect must include `iface` (Task 4) before Task 7's reload restores it.

**Deferred (per design):** inline visual expansion of a subchain's inner graph; deep recursive validation of referenced chains; output ports bound to a named agent sub-section (each output port surfaces one inner node's `output`); diff-view conflict UI (`diff-match-patch` is available for it later).
