# Phase 5 — Group C (Hard) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the two architectural items — subgraph / nested-chain nodes (§2.4) with recursion + cross-chain cycle detection, and external-edit file-watch sync (§2.8) with a real conflict story.

**Architecture:** §2.4 adds a `subchain` node kind that the executor runs by recursively calling `runChainGraph` on the referenced chain (collapsed: only the subchain node's aggregated output surfaces). Cross-chain cycles are caught by a pure reference-graph walk; a depth guard backstops it. §2.8 watches the entity file with `chokidar` over an SSE route; a pure `reconcileExternalEdit` decides ignore-echo / adopt / conflict, and the editor either silently adopts disk or shows a non-destructive banner.

**Tech Stack:** Next.js 16.2.2 (app router, **Node runtime** for the watch route), React 19, `@xyflow/react`, `chokidar ^5`, `tsx` tests.

**Design source:** `docs/maestro/plans/2026-06-29-phase5-backlog-design.md` (Group C). **Assumes Groups A and B are merged** (reducer + `setGraph` action, inline run, `seedPositions`).

## Global Constraints

- **Next.js 16 — consult the project skill.** Before writing the watch route (Task 6), read `.agents/skills/nextjs16.md` (authoritative), then `node_modules/next/dist/docs/` for gaps. For the SSE watch route: `req.nextUrl.searchParams` is **synchronous** — do **not** `await` it (only the `searchParams`/`params` *props* and `cookies()`/`headers()` are async); set `runtime = 'nodejs'` (chokidar needs Node) and `dynamic = 'force-dynamic'` (a `GET` stream must not be cached).
- **React Flow v12 (@xyflow/react) — consult the project skill.** Read `.agents/skills/xyflow12.md` before adding `SubchainNode` (Task 4): **named imports only**, `NodeProps<Node<EditorNodeData>>` typing (matches the existing nodes), **no direct mutation**.
- **v1 subchain simplification (locked):** a subchain node exposes exactly one input socket `input` and one output socket `output`. Multi-seed inputs and per-terminal-named outputs are deferred. This keeps socket derivation and executor mapping trivial — `nodeSockets`/`validateChain` socket calls do **not** need the chain registry; only cycle-detection and the executor do.
- **v1 subchain execution (locked):** collapsed — run the referenced chain and surface its terminal output on the node. No inline visual expansion of inner nodes; inner run does not stream into the parent canvas.
- **`chains` is an optional argument** (`= []`) wherever added, so existing callers keep compiling.
- **Tests are framework-free scripts** (`node:assert`, `npx tsx tests/<file>.test.ts`, end with `console.log('✅ … passed')`). UI tasks end with manual verification, then commit. One commit per task.

---

## File Structure

**§2.4 subchain nodes**
- Modify: `lib/types.ts` — `'subchain'` kind + `subchain?` field.
- Modify: `lib/serializeChain.ts`, `lib/parseChain.ts` — round-trip the field.
- Create: `tests/subchain-roundtrip.test.ts`.
- Modify: `lib/nodeSockets.ts` — fixed `input`/`output` sockets for subchain.
- Modify: `lib/chainGraph.ts` — `validateChain(…, chains?)` + `validateSubchains` (unknown ref + cross-chain cycle).
- Create: `tests/validate-subchain.test.ts`.
- Modify: `lib/executor.ts` — `runChainGraph(…, chains?, depth?)` + `subchain` recursion + depth guard.
- Create: `tests/executor-subchain.test.ts`.
- Create: `components/editor/nodes/SubchainNode.tsx`; Modify: `components/editor/ChainCanvas.tsx`, `components/editor/NodePalette.tsx`, `components/editor/nodeData.ts`, `components/editor/ChainEditor.tsx`, `app/workspace/page.tsx`, `app/api/run/route.ts`.

**§2.8 file-watch sync**
- Create: `lib/syncReconcile.ts` + `tests/sync-reconcile.test.ts`.
- Create: `app/api/watch/route.ts`, `hooks/useFileWatch.ts`.
- Modify: `hooks/useAutoSave.ts` (expose `getLastSaved`), `components/editor/ChainEditor.tsx`.

---

## Task 1: Subchain data model + round-trip (§2.4)

Add the node kind and field, and make it survive serialize → parse.

**Files:**
- Modify: `lib/types.ts`, `lib/serializeChain.ts`, `lib/parseChain.ts`
- Test: `tests/subchain-roundtrip.test.ts`

**Interfaces:**
- Produces: `ChainNodeKind` includes `'subchain'`; `ChainNode.subchain?: string`.

- [ ] **Step 1: Write the failing round-trip test.** New file `tests/subchain-roundtrip.test.ts`:

```ts
import assert from 'node:assert'
import { serializeChain } from '../lib/serializeChain'
import { parseChainContent } from '../lib/parseChain'
import { ChainNode, ChainEdge } from '../lib/types'

const nodes: ChainNode[] = [
  { id: 'seed', kind: 'seed', pos: [0, 0] },
  { id: 'sub', kind: 'subchain', subchain: 'triage', pos: [200, 0] },
]
const edges: ChainEdge[] = [{ fromNode: 'seed', fromSocket: 'output', toNode: 'sub', toSocket: 'input' }]

const raw = serializeChain({ name: 'Has Subchain', description: '' }, nodes, edges)
const parsed = parseChainContent(raw, 'has-subchain')
const sub = parsed.nodes.find(n => n.id === 'sub')!
assert.strictEqual(sub.kind, 'subchain')
assert.strictEqual(sub.subchain, 'triage')

console.log('✅ subchain-roundtrip tests passed')
```

- [ ] **Step 2: Run to verify failure**

Run: `npx tsx tests/subchain-roundtrip.test.ts`
Expected: FAIL — `sub.subchain` is `undefined` (not serialized/parsed).

- [ ] **Step 3: Add the kind + field.** In `lib/types.ts`:

```ts
export type ChainNodeKind = 'seed' | 'context' | 'agent' | 'gate' | 'branch' | 'decider' | 'loop-start' | 'loop-end' | 'subchain'
```

  And add to the `ChainNode` interface (near `agent?`/`file?`):

```ts
  subchain?: string      // kind === 'subchain' (referenced chain slug)
```

- [ ] **Step 4: Serialize the field.** In `lib/serializeChain.ts`, add a case in `serializeNode`'s `switch`:

```ts
    case 'subchain':
      if (n.subchain !== undefined) out.subchain = n.subchain
      break
```

- [ ] **Step 5: Parse the field.** In `lib/parseChain.ts`, add to the node-mapping object (alongside `agent`, `file`):

```ts
        subchain: n.subchain as string | undefined,
```

- [ ] **Step 6: Run to verify pass (and no regression)**

Run: `npx tsx tests/subchain-roundtrip.test.ts && npx tsx tests/serialize-chain.test.ts`
Expected: both PASS.

- [ ] **Step 7: Commit**

```bash
git add lib/types.ts lib/serializeChain.ts lib/parseChain.ts tests/subchain-roundtrip.test.ts
git commit -m "feat: subchain node kind + field with serialize/parse round-trip"
```

---

## Task 2: Subchain sockets + validation (§2.4)

Fixed sockets, plus reference + cross-chain-cycle validation.

**Files:**
- Modify: `lib/nodeSockets.ts`, `lib/chainGraph.ts`, `app/api/run/route.ts`
- Test: `tests/validate-subchain.test.ts`

**Interfaces:**
- Consumes: `ChainDef`, `ChainNode`.
- Produces: `validateChain(chain: ChainDef, agents: AgentDef[], chains?: ChainDef[]): ValidationResult` (new optional 3rd arg, default `[]`); `inputSocketsOf`/`outputSocketsOf` return `['input']`/`['output']` for subchain.

- [ ] **Step 1: Write the failing validation tests.** New file `tests/validate-subchain.test.ts`:

```ts
import assert from 'node:assert'
import { validateChain } from '../lib/chainGraph'
import { ChainDef } from '../lib/types'

const mk = (slug: string, refs: string[]): ChainDef => ({
  slug, name: slug, description: '', filePath: '',
  nodes: [
    { id: 'seed', kind: 'seed' },
    ...refs.map((r, i) => ({ id: `sub${i}`, kind: 'subchain' as const, subchain: r })),
  ],
  edges: refs.map((_, i) => ({ fromNode: 'seed', fromSocket: 'output', toNode: `sub${i}`, toSocket: 'input' })),
})

// unknown reference is an error
const unknown = validateChain(mk('a', ['ghost']), [], [mk('a', ['ghost'])])
assert.ok(unknown.errors.some(e => /unknown chain|not found/i.test(e)))

// self-reference is a cycle
const selfRef = mk('a', ['a'])
const selfRes = validateChain(selfRef, [], [selfRef])
assert.ok(selfRes.errors.some(e => /cycle/i.test(e)))

// mutual A<->B is a cycle
const A = mk('a', ['b'])
const B = mk('b', ['a'])
assert.ok(validateChain(A, [], [A, B]).errors.some(e => /cycle/i.test(e)))

// a valid acyclic reference passes the subchain checks
const P = mk('p', ['q'])
const Q = mk('q', [])
const ok = validateChain(P, [], [P, Q])
assert.ok(!ok.errors.some(e => /cycle|unknown chain/i.test(e)))

console.log('✅ validate-subchain tests passed')
```

- [ ] **Step 2: Run to verify failure**

Run: `npx tsx tests/validate-subchain.test.ts`
Expected: FAIL — no subchain validation yet (cycles/unknown not reported).

- [ ] **Step 3: Add subchain sockets.** In `lib/nodeSockets.ts`:

  In `inputSocketsOf`, before the final `return []`:

```ts
  if (node.kind === 'subchain') return ['input']
```

  In `outputSocketsOf`, before the agent-derived block (e.g. right after the seed/context line):

```ts
  if (node.kind === 'subchain') return ['output']
```

- [ ] **Step 4: Add validation.** In `lib/chainGraph.ts`:

  Change the signature and thread the new arg:

```ts
export function validateChain(chain: ChainDef, agents: AgentDef[], chains: ChainDef[] = []): ValidationResult {
```

  Add `'subchain'` to `allowedKinds` and make it accept inputs — update both sets:

```ts
  const acceptsInputs = (n: ChainNode): boolean =>
    n.kind === 'agent' || n.kind === 'decider' || n.kind === 'gate' || n.kind === 'branch' ||
    n.kind === 'loop-start' || n.kind === 'loop-end' || n.kind === 'subchain'

  const allowedKinds = new Set<string>(['seed', 'context', 'agent', 'gate', 'branch', 'decider', 'loop-start', 'loop-end', 'subchain'])
```

  Just before `return { valid: errors.length === 0, errors, issues }`, call the new check:

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
    if (!bySlug.has(n.subchain) && n.subchain !== chain.slug) {
      add(`Node "${n.id}": references unknown chain "${n.subchain}"`, { nodeId: n.id })
    }
  }

  // cross-chain cycle: does `chain` reach itself through subchain references?
  const reaches = (start: ChainDef, target: string, seen: Set<string>): boolean => {
    for (const ref of refsOf(start)) {
      if (ref === target) return true
      const next = bySlug.get(ref)
      if (next && !seen.has(ref)) { seen.add(ref); if (reaches(next, target, seen)) return true }
    }
    return false
  }
  if (reaches(chain, chain.slug, new Set())) {
    add(`Chain "${chain.slug}" has a subchain reference cycle`, {})
  }
}
```

- [ ] **Step 5: Pass `chains` from the run route.** In `app/api/run/route.ts`, update the validate call (the route already destructures `chains` from `loadWorkspace()`):

```ts
  const validation = validateChain(chain, agents, chains)
```

- [ ] **Step 6: Run to verify pass (and no regression)**

Run: `npx tsx tests/validate-subchain.test.ts && npx tsx tests/validate-issues.test.ts && npx tsx tests/validate-loop.test.ts && npx tsx tests/validate-control.test.ts`
Expected: all PASS (the new arg defaults to `[]`, so existing validation tests are unaffected).

- [ ] **Step 7: Commit**

```bash
git add lib/nodeSockets.ts lib/chainGraph.ts app/api/run/route.ts tests/validate-subchain.test.ts
git commit -m "feat: subchain sockets + reference/cross-chain-cycle validation"
```

---

## Task 3: Subchain executor recursion (§2.4)

Run a subchain node by recursively executing the referenced chain; surface its terminal output. Depth-guarded.

**Files:**
- Modify: `lib/executor.ts`, `app/api/run/route.ts`
- Test: `tests/executor-subchain.test.ts`

**Interfaces:**
- Consumes: `runChainGraph` (recursive), `ChainDef`, `AgentDef`, `AgentOutput`.
- Produces: `runChainGraph(chain, agents, skills, seedPrompt, workspacePath, callbacks, runFn?, startOutputs?, chains?: ChainDef[], depth?: number)` (two new trailing optional args).

- [ ] **Step 1: Write the failing executor test.** New file `tests/executor-subchain.test.ts`:

```ts
import assert from 'node:assert'
import { runChainGraph } from '../lib/executor'
import { AgentDef, AgentOutput, ChainDef } from '../lib/types'

const agent = (slug: string): AgentDef => ({
  slug, name: slug, model: 'gpt-4o', description: '', skills: [], context: [],
  input_from: 'user', output_format: 'markdown', outputs: [], inputs: [],
  systemPrompt: 'do the thing', filePath: '',
})

const fakeRun = async (a: AgentDef): Promise<AgentOutput> => ({
  agentName: a.name, systemPrompt: '', input: '', output: `OUT:${a.slug}`,
  tokensIn: 0, tokensOut: 0, costUsd: 0, latencyMs: 0, model: '', timestamp: new Date().toISOString(), status: 'success',
})

const noop = { onStart() {}, onToken() {}, onDone() {} }

const inner: ChainDef = {
  slug: 'inner', name: 'Inner', description: '', filePath: '',
  nodes: [{ id: 'seed', kind: 'seed' }, { id: 'w', kind: 'agent', agent: 'w' }],
  edges: [{ fromNode: 'seed', fromSocket: 'output', toNode: 'w', toSocket: 'input' }],
}
const parent: ChainDef = {
  slug: 'parent', name: 'Parent', description: '', filePath: '',
  nodes: [{ id: 'seed', kind: 'seed' }, { id: 'sub', kind: 'subchain', subchain: 'inner' }],
  edges: [{ fromNode: 'seed', fromSocket: 'output', toNode: 'sub', toSocket: 'input' }],
}

const results = await runChainGraph(parent, [agent('w')], [], 'go', '/tmp', noop, fakeRun, [], [inner])
const subOut = results.find(r => r.nodeId === 'sub')
assert.ok(subOut, 'subchain node produced a result')
assert.strictEqual(subOut!.output, 'OUT:w')   // inner terminal output surfaced

// depth guard: calling beyond the max throws
await assert.rejects(
  () => runChainGraph(parent, [agent('w')], [], 'go', '/tmp', noop, fakeRun, [], [inner], 99),
  /too deep/i,
)

console.log('✅ executor-subchain tests passed')
```

- [ ] **Step 2: Run to verify failure**

Run: `npx tsx tests/executor-subchain.test.ts`
Expected: FAIL — `subOut` is undefined (subchain kind not handled) / no depth guard.

- [ ] **Step 3: Implement recursion.** In `lib/executor.ts`:

  Extend the signature (add the two trailing optional params):

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

  Add `'subchain'` to `usedSlots` (so its `input` is gated like any consumer) — in the `usedSlots` function:

```ts
    if (node.kind === 'subchain') return ['input']
```

  Generalize the `inValue` helper to read any slot, then define a terminal-output picker. Replace `inValue` with:

```ts
  const slotValue = (nodeId: string, slot: string): string => {
    const idx = liveEdgeForSlot(nodeId, slot)
    if (idx === undefined) return ''
    const e = chain.edges[idx]
    const src = nodeById.get(e.fromNode)
    return src ? socketValue(src, e.fromSocket, nodeOutputs, seedPrompt, readContext) : ''
  }
  const inValue = (nodeId: string): string => slotValue(nodeId, 'in')

  const terminalOutput = (ref: ChainDef, innerResults: AgentOutput[]): string => {
    const hasOutgoing = new Set(ref.edges.map(e => e.fromNode))
    const sinks = new Set(ref.nodes.filter(n => !hasOutgoing.has(n.id)).map(n => n.id))
    for (let i = innerResults.length - 1; i >= 0; i--) {
      const r = innerResults[i]
      if (r.nodeId && sinks.has(r.nodeId) && r.output) return r.output
    }
    for (let i = innerResults.length - 1; i >= 0; i--) if (innerResults[i].output) return innerResults[i].output
    return ''
  }
```

  In the main topo loop, add a `subchain` branch to the kind dispatch (after the `branch` branch):

```ts
    } else if (node.kind === 'subchain') {
      const ref = chains.find(c => c.slug === node.subchain)
      if (!ref) {
        const rec = controlOutput(nodeId, `subchain: ${node.subchain ?? '?'} (missing)`, '', 'error')
        nodeOutputs.set(nodeId, rec); results.push(rec); callbacks.onDone(nodeId, rec)
      } else {
        callbacks.onStart(nodeId, ref.name)
        const innerSeed = slotValue(nodeId, 'input')
        const innerResults = await runChainGraph(
          ref, agents, skills, innerSeed, workspacePath,
          { onStart: () => {}, onToken: () => {}, onDone: () => {} },
          runFn, [], chains, depth + 1,
        )
        const rec = controlOutput(nodeId, ref.name, terminalOutput(ref, innerResults), 'success')
        nodeOutputs.set(nodeId, rec); results.push(rec); callbacks.onDone(nodeId, rec)
        markOut(nodeId, () => true)
      }
    }
```

  > `controlOutput`, `slotValue`, `markOut`, `socketValue`, `nodeOutputs`, and `results` already exist in this function — reuse them. The inner run uses no-op callbacks (collapsed v1): only the subchain node's own `onStart`/`onDone` reach the parent stream.

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
git commit -m "feat: executor runs subchain nodes recursively (collapsed) with a depth guard"
```

---

## Task 4: Subchain UI (§2.4)

A node to add/pick a referenced chain, plus threading the chain list to validation.

**Files:**
- Create: `components/editor/nodes/SubchainNode.tsx`
- Modify: `components/editor/ChainCanvas.tsx`, `components/editor/NodePalette.tsx`, `components/editor/nodeData.ts`, `components/editor/ChainEditor.tsx`, `app/workspace/page.tsx`

**Interfaces:**
- Consumes: `EditorNodeData` (+ new `chains`), `ChainDef`.
- Produces: `EditorNodeData.chains: { slug: string; name: string }[]`; `ChainEditor` new prop `chains: ChainDef[]`.

- [ ] **Step 1: Skim `.agents/skills/xyflow12.md`** (custom node typing, named imports, no-mutation) and confirm passing `chains` as a prop from the client `page.tsx` down to `ChainEditor` is fine (it already passes `agents`/`contextFiles` this way).

- [ ] **Step 2: Add `chains` to `EditorNodeData`.** In `components/editor/nodeData.ts`, add inside the interface:

```ts
  chains: { slug: string; name: string }[]
```

- [ ] **Step 3: Create the node.** New file `components/editor/nodes/SubchainNode.tsx`:

```tsx
'use client'
import React, { memo } from 'react'
import { Handle, Position, type NodeProps, type Node } from '@xyflow/react'
import type { EditorNodeData } from '../nodeData'
import { statusDotClass } from '../nodeData'

function SubchainNode({ data, selected }: NodeProps<Node<EditorNodeData>>) {
  const { node, run, issues } = data
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
          <div className="relative pl-3 flex items-center h-5">
            <Handle type="target" id="input" position={Position.Left} style={{ left: -16, top: '50%', transform: 'translateY(-50%)' }} className="w-2.5 h-2.5 border-2 border-white !bg-zinc-400" />
            <span>input</span>
          </div>
          <div className="relative pr-3 flex items-center justify-end h-5">
            <span>.output</span>
            <Handle type="source" id="output" position={Position.Right} style={{ right: -16, top: '50%', transform: 'translateY(-50%)' }} className="w-2.5 h-2.5 border-2 border-white !bg-zinc-900" />
          </div>
        </div>
      </div>
    </div>
  )
}
export default memo(SubchainNode)
```

- [ ] **Step 4: Register the node type.** In `components/editor/ChainCanvas.tsx`, import and add to `nodeTypes`:

```tsx
import SubchainNode from './nodes/SubchainNode'
```

```ts
  gate: GateNode, branch: BranchNode, 'loop-start': LoopStartNode, 'loop-end': LoopEndNode,
  subchain: SubchainNode,
  zoneFrame: ZoneFrame,
```

- [ ] **Step 5: Add a palette entry.** In `components/editor/NodePalette.tsx`, add to `ITEMS` and `GROUPS`:

```ts
  { kind: 'subchain', label: 'Subchain', group: 'Composite' },
```

```ts
const GROUPS = ['Sources', 'Agents', 'Control flow', 'Loop', 'Composite']
```

- [ ] **Step 6: Thread `chains` into the editor.** In `components/editor/ChainEditor.tsx`:

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

  Pass `chains` to validation and to `buildData`:

```ts
  const validation = useMemo(() => validateChain(chain, agents, chains), [chain, agents, chains])
```

  In `buildData`'s returned object add (and add `chains` to its dep array):

```ts
    chains: chains.map(c => ({ slug: c.slug, name: c.name })),
```

- [ ] **Step 7: Provide `chains` from the page.** In `app/workspace/page.tsx`:

  Add state and populate it in `refetchEditorData` (Group A introduced that function):

```ts
  const [editorChains, setEditorChains] = useState<ChainDef[]>([])
```

```ts
  const refetchEditorData = useCallback(() => {
    fetch('/api/workspace')
      .then(r => r.json())
      .then(w => { setEditorAgents(w.agents ?? []); setEditorContext(w.context ?? []); setEditorChains(w.chains ?? []) })
      .catch(() => { setEditorAgents([]); setEditorContext([]); setEditorChains([]) })
  }, [])
```

  Pass it to the editor JSX:

```tsx
                      chains={editorChains}
```

- [ ] **Step 8: Typecheck + manual verification**

Run: `npx tsc --noEmit` (expect no errors), then `npm run dev`:
- Palette shows a **Composite → Subchain** entry; adding it drops a subchain node with `input`/`output` handles.
- Picking a chain in its dropdown wires it; **Open chain →** navigates to that chain.
- Referencing a chain that (transitively) references this one surfaces a "reference cycle" validation issue in the panel.
- Running a chain whose subchain points at a real chain produces output on the subchain node (its referenced chain's terminal output).

- [ ] **Step 9: Commit**

```bash
git add components/editor/nodes/SubchainNode.tsx components/editor/ChainCanvas.tsx components/editor/NodePalette.tsx components/editor/nodeData.ts components/editor/ChainEditor.tsx app/workspace/page.tsx
git commit -m "feat: subchain node UI — palette, node, chain picker, validation wiring"
```

---

## Task 5: External-edit reconciliation logic (§2.8)

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

// our own autosave write echoed back -> ignore
assert.strictEqual(reconcileExternalEdit({ local: 'A', lastSaved: 'A', incoming: 'A' }), 'ignore-echo')

// disk changed, no local edits -> adopt
assert.strictEqual(reconcileExternalEdit({ local: 'A', lastSaved: 'A', incoming: 'B' }), 'adopt')

// disk changed AND we have unsaved local edits -> conflict
assert.strictEqual(reconcileExternalEdit({ local: 'C', lastSaved: 'A', incoming: 'B' }), 'conflict')

// incoming equals lastSaved even with local edits -> still just an echo (no external change)
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

## Task 6: File-watch route + hook + editor integration (§2.8)

Watch the entity file, stream changes, and apply the reconciliation in the editor.

**Files:**
- Create: `app/api/watch/route.ts`, `hooks/useFileWatch.ts`
- Modify: `hooks/useAutoSave.ts`, `components/editor/ChainEditor.tsx`

**Interfaces:**
- Consumes: `reconcileExternalEdit` (Task 5), `parseChainContent`, `seedPositions`, `chokidar`, `resolveEntityPath`.
- Produces: `GET /api/watch?type&slug` (SSE, emits `{ type: 'change', raw }`); `useFileWatch(type, slug): string | null`; `useAutoSave` adds `getLastSaved: () => string` to its return.

- [ ] **Step 1: Read `.agents/skills/nextjs16.md`** (route handlers, caching, runtime), then `node_modules/next/dist/docs/` for gaps — confirm `export const runtime = 'nodejs'`, `export const dynamic = 'force-dynamic'`, and `ReadableStream` SSE responses for this version before writing the route. `req.nextUrl.searchParams` is synchronous (no `await`).

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
      const close = () => { watcher.close(); try { controller.close() } catch {} }
      req.signal.addEventListener('abort', close)
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

  Pull `content` and `getLastSaved` from `useAutoSave` (in addition to what's already destructured), subscribe, and reconcile:

```ts
  const { setContent, status, content, getLastSaved } = useAutoSave('chain', slug, initialMarkdown)
  const incoming = useFileWatch('chain', slug)
  const [conflict, setConflict] = useState<string | null>(null)

  useEffect(() => {
    if (incoming == null) return
    const decision = reconcileExternalEdit({ local: content, lastSaved: getLastSaved(), incoming })
    if (decision === 'adopt') {
      const parsed = parseChainContent(incoming, slug)
      dispatch({ type: 'setGraph', nodes: seedPositions(parsed.nodes, parsed.edges), edges: parsed.edges })
    } else if (decision === 'conflict') {
      setConflict(incoming)
    }
  }, [incoming]) // eslint-disable-line react-hooks/exhaustive-deps
```

  Add the imports: `useFileWatch` from `@/hooks/useFileWatch`, `reconcileExternalEdit` from `@/lib/syncReconcile`, and ensure `parseChainContent` from `@/lib/parseChain` is imported.

  Render a non-destructive banner when `conflict` is set (place above the canvas, near the `runError` banner):

```tsx
      {conflict && (
        <div className="px-4 py-1.5 text-[11px] text-amber-700 bg-amber-50 border-b border-amber-100 flex items-center gap-3">
          <span>This chain changed on disk.</span>
          <button
            className="font-bold underline"
            onClick={() => {
              const parsed = parseChainContent(conflict, slug)
              dispatch({ type: 'setGraph', nodes: seedPositions(parsed.nodes, parsed.edges), edges: parsed.edges })
              setConflict(null)
            }}
          >Reload from disk</button>
          <button className="font-bold underline" onClick={() => setConflict(null)}>Keep my version</button>
        </div>
      )}
```

- [ ] **Step 6: Manual verification**

Run: `npm run dev`, open a chain in Graph mode:
- With no unsaved edits, change the chain's `.md` on disk (another editor) → the canvas updates silently (adopt).
- Make an unsaved canvas edit, then change the file on disk → the amber **conflict banner** appears; **Reload from disk** replaces the canvas with disk; **Keep my version** dismisses and the next autosave overwrites disk.
- Normal editing does **not** loop or flicker (your own autosave write is ignored as an echo).

- [ ] **Step 7: Commit**

```bash
git add app/api/watch/route.ts hooks/useFileWatch.ts hooks/useAutoSave.ts components/editor/ChainEditor.tsx
git commit -m "feat: external-edit file-watch sync with adopt/conflict reconciliation"
```

---

## Self-Review

**Spec coverage (Group C of the design doc):**
- §2.4 data model + round-trip → Task 1. ✓
- §2.4 sockets + cross-chain cycle validation → Task 2 (`validateSubchains`; `chains` optional arg; fixed sockets). ✓
- §2.4 executor recursion + depth guard + namespacing-via-no-op-callbacks → Task 3. ✓
- §2.4 UI (node, palette, picker, chains threaded to validation/run) → Task 4. ✓
- §2.8 reconciliation logic → Task 5 (all three branches tested). ✓
- §2.8 watch route + hook + echo suppression + adopt/conflict banner → Task 6. ✓

**Placeholder scan:** No TBD/TODO; pure modules ship complete code + tests; UI/route steps list concrete expected outcomes and gate on reading the Next.js docs. ✓

**Type consistency:** `subchain` kind + `ChainNode.subchain`; `validateChain(…, chains?)`; `runChainGraph(…, chains?, depth?)`; `EditorNodeData.chains`; `ChainEditor` prop `chains: ChainDef[]`; `Reconciliation`/`reconcileExternalEdit`; `useFileWatch`; `useAutoSave().getLastSaved` — defined once and consumed by name. The executor's `subchain` branch uses helpers (`controlOutput`, `slotValue`, `markOut`, `socketValue`) that already exist in `runChainGraph`. ✓

**v1 deviations from the design (intentional, recorded in Global Constraints):** subchain exposes fixed `input`/`output` sockets (design mentioned per-terminal-named outputs) — chosen for trivial mapping; multi-output deferred. Diff-view conflict UI deferred (`diff-match-patch` is available for v2).

**Assumptions:** `socketValue(node, 'output', …)` returns a control/subchain node's stored output for downstream reads (same path gate/branch/loop-end already rely on). If `resolveNode.socketValue` special-cases kinds, extend it to treat `subchain` like `gate` (return the node's recorded output) — verify when implementing Task 3.
