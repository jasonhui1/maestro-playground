# Coherent Run Trace + Report Node — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: use superpowers:subagent-driven-development or
> superpowers:executing-plans to implement this task-by-task. Steps use `- [ ]` checkboxes.
> **Before any canvas / App Router code, read `.agents/skills/xyflow12.md` and
> `.agents/skills/nextjs16.md`.**

**Goal:** (A) add a passive `report` (display) node — one input, no LLM, output = input; and
(B) make the `/history/[runId]` Graph view reuse the chain editor's node components read-only so
history matches the editor, deleting the legacy trace renderers.

**Spec:** [2026-06-30-coherent-trace-and-report-node-design.md](2026-06-30-coherent-trace-and-report-node-design.md)

**Tech stack:** Next.js 16 (App Router), React 19, TypeScript, `@xyflow/react` v12, `dagre`,
`gray-matter`, `tsx` (existing unit-test runner — see `npx tsx tests/*.test.ts`).

## Global Constraints
- **No changes to `lib/runner.ts` or `lib/logger.ts`.** The report node is pure-executor.
- **Read-only history:** no drag-to-wire, delete, field edits, or "▶ here" in the history canvas.
- **New runs only get the Graph view.** `!run.graph` ⇒ List only, Graph toggle hidden.
- **Keep `slugify` / `extractSection` / `extractSections` in `lib/graph.ts`** (executor,
  resolveNode, nodeSockets import them). Only the two graph *builders* + trace components go.
- **Style:** existing zinc/white Tailwind + Lucide; reuse `ZoneFrame`.

---

## File Structure
- Modify: `lib/types.ts` — `ChainNodeKind` += `'report'`.
- Modify: `lib/nodeSockets.ts` — `report` sockets.
- Modify: `lib/executor.ts` — `usedSlots` + `report` branch.
- Modify: `lib/chainGraph.ts` — `validateChain` report support.
- Create: `tests/report-sockets.test.ts`, `tests/report-validate.test.ts`,
  `tests/report-executor.test.ts`.
- Create: `components/editor/nodes/ReportNode.tsx`.
- Modify: `components/editor/ChainCanvas.tsx` — register `report`; add `readOnly` prop.
- Modify: `components/editor/NodePalette.tsx` — `Report` item.
- Modify: `components/editor/nodeData.ts` — `readOnly?: boolean`.
- Modify: editor node components — honor `readOnly`.
- Create: `lib/runHistoryState.ts` + `tests/runHistoryState.test.ts`.
- Modify: `components/trace/RunNodePreview.tsx` — take a `ChainNode`.
- Modify: `app/history/[runId]/page.tsx` — read-only canvas; List-only legacy.
- Delete: `lib/graph.ts` `buildRunGraph` + `buildRunGraphFromSnapshot`;
  `components/trace/{RunGraph,TraceAgentNode,SeedNode,ContextNode}.tsx`.
- Extend: `tests/serializeChain.test.ts` (report round-trip) if that test file exists; else add it.

---

# PART A — Report (display) node

## Task A1: `report` kind + sockets

**Files:** Modify `lib/types.ts`, `lib/nodeSockets.ts`. Test `tests/report-sockets.test.ts`.

- [ ] **Step 1 — failing test.** Create `tests/report-sockets.test.ts`:
```ts
import assert from 'node:assert'
import { inputSocketsOf, outputSocketsOf } from '../lib/nodeSockets'
import type { ChainDef, ChainNode } from '../lib/types'

const chain: ChainDef = { slug: 'c', name: 'c', description: '', nodes: [], edges: [], filePath: '' }
const report: ChainNode = { id: 'r1', kind: 'report' }

assert.deepStrictEqual(inputSocketsOf(report, chain, [], []), ['in'])
assert.deepStrictEqual(outputSocketsOf(report, chain, [], []), [])
console.log('✅ report sockets tests passed')
```
- [ ] **Step 2 — run, expect fail.** `npx tsx tests/report-sockets.test.ts` → fails (kind not allowed / fallback returns `['output']`).
- [ ] **Step 3a — types.** In `lib/types.ts`, add `'report'` to the `ChainNodeKind` union.
- [ ] **Step 3b — sockets.** In `lib/nodeSockets.ts`:
  - In `inputSocketsOf`, add before the agent branch: `if (node.kind === 'report') return ['in']`.
  - In `outputSocketsOf`, add before the final agent fallback: `if (node.kind === 'report') return []`.
- [ ] **Step 4 — pass.** `npx tsx tests/report-sockets.test.ts` → `✅`.
- [ ] **Step 5 — commit.** `git add lib/types.ts lib/nodeSockets.ts tests/report-sockets.test.ts && git commit -m "feat: add report node kind + sockets"`

## Task A2: executor passthrough

**Files:** Modify `lib/executor.ts`. Test `tests/report-executor.test.ts`.

- [ ] **Step 1 — failing test.** Create `tests/report-executor.test.ts`. Build a minimal chain
  `seed → report` and a `runFn` spy; assert the report output equals the seed and the spy was not
  called for it. (Mirror the harness in existing executor/`chainGraph` tests — construct
  `ChainDef`, `AgentDef[]=[]`, `skills=[]`, pass a fake `runFn`.)
```ts
import assert from 'node:assert'
import { runChainGraph } from '../lib/executor'
import type { ChainDef } from '../lib/types'

const chain: ChainDef = {
  slug: 'c', name: 'c', description: '', filePath: '',
  nodes: [{ id: 'seed', kind: 'seed' }, { id: 'r', kind: 'report' }],
  edges: [{ fromNode: 'seed', fromSocket: 'output', toNode: 'r', toSocket: 'in' }],
}
let called = 0
const runFn = (async () => { called++; throw new Error('should not run') }) as any

const results = await runChainGraph(
  chain, [], [], 'HELLO WORLD', process.cwd(),
  { onStart() {}, onToken() {}, onDone() {} }, runFn,
)
const rep = results.find(r => r.nodeId === 'r')!
assert.strictEqual(rep.output, 'HELLO WORLD', 'report passes seed through')
assert.strictEqual(rep.status, 'success')
assert.strictEqual(called, 0, 'no model call for report')
console.log('✅ report executor tests passed')
```
- [ ] **Step 2 — run, expect fail.** `npx tsx tests/report-executor.test.ts` → report has no branch, output empty.
- [ ] **Step 3a — usedSlots.** In `lib/executor.ts` `usedSlots`, alongside the gate/branch case,
  add: `if (node.kind === 'report') return ['in']`.
- [ ] **Step 3b — execution branch.** In the main `for (const nodeId of topoOrder(chain))` loop,
  after the `branch` handler and before `subchain`, add:
```ts
} else if (node.kind === 'report') {
  const rec = controlOutput(nodeId, 'report', inValue(nodeId), 'success')
  nodeOutputs.set(nodeId, rec); results.push(rec); callbacks.onDone(nodeId, rec)
  markOut(nodeId, () => true)
}
```
- [ ] **Step 4 — pass.** `npx tsx tests/report-executor.test.ts` → `✅`.
- [ ] **Step 5 — commit.** `git add lib/executor.ts tests/report-executor.test.ts && git commit -m "feat: executor passes input through report node (no model call)"`

## Task A3: validation

**Files:** Modify `lib/chainGraph.ts`. Test `tests/report-validate.test.ts`.

- [ ] **Step 1 — failing test.** Create `tests/report-validate.test.ts`: a valid `seed → report.in`
  chain is `valid`; a chain with an edge *out of* a report (`report.output → …`) reports an error
  (no such output socket); an unwired report produces a warning. (Use `validateChain(chain, [], [])`.)
- [ ] **Step 2 — run, expect fail** (`report` rejected as invalid kind).
- [ ] **Step 3 — implement.** In `lib/chainGraph.ts` `validateChain`:
  - add `'report'` to the `allowedKinds` set;
  - add `n.kind === 'report'` to the `acceptsInputs` predicate;
  - after the per-node kind checks, add a warning when a report has no incoming `in` edge:
    `if (n.kind === 'report' && !chain.edges.some(e => e.toNode === n.id && e.toSocket === 'in')) warn(...)`.
  (Out-edges from a report are already flagged because `outputSocketsOf(report) === []`.)
- [ ] **Step 4 — pass** `npx tsx tests/report-validate.test.ts` → `✅`.
- [ ] **Step 5 — commit.** `git add lib/chainGraph.ts tests/report-validate.test.ts && git commit -m "feat: validate report node (terminal sink)"`

## Task A4: serialization round-trip (guard)

**Files:** Test only (`serializeChain`/`parseChainContent` already handle unknown kinds generically).

- [ ] **Step 1 — test.** Add to `tests/serializeChain.test.ts` (create if absent): a chain with a
  `report` node + a `seed→report.in` edge survives `serializeChain → parseChainContent` with kind
  and edge intact. Run `npx tsx tests/serializeChain.test.ts` → `✅`.
- [ ] **Step 2 — commit.** `git add tests/serializeChain.test.ts && git commit -m "test: report node round-trips through serialize/parse"`

## Task A5: editor — ReportNode component + palette + canvas registration

> UI; manual verification (no component test harness). Read `.agents/skills/xyflow12.md` first.

**Files:** Create `components/editor/nodes/ReportNode.tsx`; modify `ChainCanvas.tsx`,
`NodePalette.tsx`. (`ChainEditor.addNodeOfKind` already mints `{id, kind, pos}` generically —
no change needed.)

- [ ] **Step 1 — ReportNode.** Mirror `components/editor/nodes/GateNode.tsx`, but: header label
  `Report` with a `FileText` (lucide) icon and `statusDotClass(run)`; **one** input handle
  `id="in"` on the left; **no** output handle; no condition input. When `data.readOnly` is true,
  hide the "▶ here" button (see Task B1). Body shows a small truncated preview of
  `data.run?.output` (the passed-through content) when present, else a muted "display" hint.
- [ ] **Step 2 — register.** In `ChainCanvas.tsx` `nodeTypes`, add `report: ReportNode` and import it.
- [ ] **Step 3 — palette.** In `NodePalette.tsx`: add `{ kind: 'report', label: 'Report', group: 'Output' }`
  to `ITEMS` and `'Output'` to `GROUPS` (place after `'Composite'`).
- [ ] **Step 4 — verify.** `npm run dev`; open a chain in graph mode; add a Report node from the
  palette; wire `someAgent → report.in`; set a seed; Run. Expected: report node shows a green dot
  and the upstream value; no extra model latency on that node.
- [ ] **Step 5 — commit.** `git add components/editor/nodes/ReportNode.tsx components/editor/ChainCanvas.tsx components/editor/NodePalette.tsx && git commit -m "feat: report node in the chain editor + palette"`

---

# PART B — Unified read-only history graph

## Task B1: `readOnly` in EditorNodeData + node components honor it

**Files:** Modify `components/editor/nodeData.ts` and each node component under
`components/editor/nodes/`.

- [ ] **Step 1 — data flag.** In `nodeData.ts`, add `readOnly?: boolean` to `EditorNodeData`.
- [ ] **Step 2 — gate edits.** In every node component that renders an editable control or the
  "▶ here" button (`AgentNode`, `GateNode`, `BranchNode`, `LoopStartNode`, `LoopEndNode`,
  `SubchainNode`, `ContextNode`, `SeedNode`, `ReportNode`): when `data.readOnly`, render values as
  static text (or set `disabled`/`readOnly` on inputs/selects) and **omit** the
  `onRunFromHere` ("▶ here") button. Handles still render (so wires anchor) but the canvas makes
  them non-interactive (Task B2).
- [ ] **Step 3 — verify (editor unaffected).** `npm run dev`; the editor (where `readOnly` is
  undefined) behaves exactly as before. Commit:
  `git add components/editor/nodeData.ts components/editor/nodes && git commit -m "feat: readOnly mode for editor node components"`

## Task B2: `readOnly` on ChainCanvas

**Files:** Modify `components/editor/ChainCanvas.tsx`.

- [ ] **Step 1 — prop.** Add optional `readOnly?: boolean` to `ChainCanvasProps`.
- [ ] **Step 2 — wire to ReactFlow.** When `readOnly`: set `nodesDraggable={false}`,
  `nodesConnectable={false}`, `edgesReconnectable={false}`, and pass `undefined` for `onConnect` /
  `onNodesDelete` / `onEdgesDelete` / `onNodeDragStop` / `onSelectionDragStop`. Keep
  `onSelectionChange` (selection drives the preview). Leave `elementsSelectable` default (true).
- [ ] **Step 3 — verify** the editor still edits normally (prop defaults to off). Commit:
  `git add components/editor/ChainCanvas.tsx && git commit -m "feat: read-only mode for ChainCanvas"`

## Task B3: `buildRunStateMap` (pure)

**Files:** Create `lib/runHistoryState.ts`. Test `tests/runHistoryState.test.ts`.

- [ ] **Step 1 — failing test.** Create `tests/runHistoryState.test.ts`: outputs with distinct
  `nodeId`s → one entry each with matching `status`/`output`; two outputs sharing a `nodeId` with
  `round: 0` and `round: 1` → `rounds.length === 2`; an output with `status: 'skipped'` preserved.
- [ ] **Step 2 — run, expect fail** (module missing).
- [ ] **Step 3 — implement.** Create `lib/runHistoryState.ts`:
```ts
import type { AgentOutput } from './types'
import type { RunStateMap, NodeRunState } from './runState'

const empty = (): NodeRunState => ({ status: 'idle', output: '', thought: '', rounds: [] })

// Fold a completed run's agentOutputs into the same RunStateMap the live editor run uses,
// keyed by nodeId. Mirrors lib/runState.applyRunEvent's agent_done case (accumulates rounds).
export function buildRunStateMap(outputs: AgentOutput[]): RunStateMap {
  const map: RunStateMap = {}
  for (const o of outputs) {
    if (!o.nodeId) continue
    const prev = map[o.nodeId] ?? empty()
    const rounds = o.round !== undefined
      ? [...prev.rounds, { round: o.round, output: o.output }]
      : prev.rounds
    map[o.nodeId] = { ...prev, status: o.status, output: o.output, thought: o.thought ?? prev.thought, agentName: o.agentName, rounds }
  }
  return map
}
```
- [ ] **Step 4 — pass** `npx tsx tests/runHistoryState.test.ts` → `✅`.
- [ ] **Step 5 — commit.** `git add lib/runHistoryState.ts tests/runHistoryState.test.ts && git commit -m "feat: build a RunStateMap overlay from a completed run"`

## Task B4: RunNodePreview takes a ChainNode

**Files:** Modify `components/trace/RunNodePreview.tsx`.

- [ ] **Step 1 — change prop type** from `TraceNode | null` to `ChainNode | null`. The body already
  resolves outputs by `node.id` (`run.agentOutputs.filter(o => o.nodeId === node.id)`); update the
  seed/context/stale branches to read `node.kind` / `node.file` and drop `TraceNode`-only fields
  (`stale`, `fileName`, `stepIndex`). For a report node, the default agent-output branch already
  renders its passthrough output — no special case needed.
- [ ] **Step 2 — commit** (compiles after Task B5 wiring): defer commit to B5.

## Task B5: history page — read-only canvas + delete legacy renderers

**Files:** Modify `app/history/[runId]/page.tsx`; **delete** `lib/graph.ts` builders and
`components/trace/{RunGraph,TraceAgentNode,SeedNode,ContextNode}.tsx`.

- [ ] **Step 1 — gate Graph view on snapshot.** Compute `const hasGraph = !!run.graph`. Only render
  the `GRAPH | LIST` toggle when `hasGraph`; default `viewMode` to `'graph'` when `hasGraph` else
  `'list'`.
- [ ] **Step 2 — render the read-only canvas.** Replace the `RunGraph` block with the editor
  canvas fed by the snapshot:
```tsx
import ChainCanvas from '@/components/editor/ChainCanvas'
import type { EditorNodeData } from '@/components/editor/nodeData'
import { inputSocketsOf, outputSocketsOf } from '@/lib/nodeSockets'
import { buildRunStateMap } from '@/lib/runHistoryState'
// …
const g = run.graph!
const chainDef = { slug: run.chainName, name: run.chainName, description: '', filePath: '', nodes: g.nodes, edges: g.edges }
const overlay = useMemo(() => buildRunStateMap(run.agentOutputs), [run.agentOutputs])
const buildData = useCallback((node: ChainNode): EditorNodeData => ({
  node,
  inputs: inputSocketsOf(node, chainDef, agents, []),
  outputs: outputSocketsOf(node, chainDef, agents, []),
  agents: agents.map(a => ({ slug: a.slug, name: a.name })),
  contextFiles: [],
  run: overlay[node.id],
  issues: [],
  onChange: () => {},
  chains: [],
  readOnly: true,
}), [chainDef, agents, overlay])
// …graph branch:
<div className="flex flex-col gap-6">
  <div className="w-full h-[520px] border border-zinc-200 rounded-2xl overflow-hidden">
    <ChainCanvas
      nodes={g.nodes} edges={g.edges} buildData={buildData}
      selectedIds={selectedNodeId ? [selectedNodeId] : []}
      onSelectionChange={(ids) => setSelectedNodeId(ids[0] ?? null)}
      onMove={() => {}} onMoveMany={() => {}} onConnect={() => {}}
      onDeleteNode={() => {}} onDeleteEdge={() => {}}
      instanceCount={0} currentInstance={0} onInstance={() => {}}
      readOnly
    />
  </div>
  <RunNodePreview
    node={g.nodes.find(n => n.id === selectedNodeId) || null}
    run={run} onBranch={handleBranch} isBranching={isBranching}
  />
</div>
```
  (`agents` is already fetched on this page. Keep the existing seed-prompt card, List, Compare,
  Export, and `handleBranch` exactly as they are.)
- [ ] **Step 3 — delete legacy.** Remove `buildRunGraph` + `buildRunGraphFromSnapshot` from
  `lib/graph.ts` (keep `slugify`, `extractSection`, `extractSections`, and any types still used);
  delete `components/trace/RunGraph.tsx`, `TraceAgentNode.tsx`, `SeedNode.tsx`, `ContextNode.tsx`,
  and their imports. Run `npx tsc --noEmit` and fix any dangling references.
- [ ] **Step 4 — verify.**
  - `npm run dev`; open `http://localhost:3000/history/2026-06-29-S0V_E1`: the graph matches the
    chain editor (refine zone frame, `loop-start`/`loop-end`, the `report` node), using saved
    positions; status dots reflect the run; clicking the report node shows the rainbow draft;
    clicking `patch` shows both loop rounds.
  - Open a `2026-04-*` run: **List view only**, no Graph toggle, no crash.
  - Confirm List / Compare / Export / Branch still work.
- [ ] **Step 5 — commit.** `git add app/history components/trace lib/graph.ts && git commit -m "refactor: history graph reuses editor components read-only; drop legacy trace renderers"`

## Task B6: final verification
- [ ] **Unit tests** — run each and confirm `✅`:
  `npx tsx tests/report-sockets.test.ts tests/report-validate.test.ts tests/report-executor.test.ts tests/runHistoryState.test.ts tests/serializeChain.test.ts` (run individually if the runner doesn't take multiple paths).
- [ ] **Type + lint** — `npx tsc --noEmit` (clean); `npm run lint` (no new errors).
- [ ] **Build** — `npm run build` succeeds.
- [ ] **Regression** — editor still edits (drag/connect/delete/▶ here) on a chain page; history is
  read-only; legacy runs List-only.
- [ ] **Constraint check** — `git diff --name-only main...HEAD` does **not** include
  `lib/runner.ts` or `lib/logger.ts`.

---

## Self-Review
- **Report node = no model call** → Task A2 (executor branch + spy test). ✓
- **Report sockets / validation / serialization** → A1, A3, A4. ✓
- **Editor authoring of report** → A5 (palette + component; `addNodeOfKind` already generic). ✓
- **History reuses editor components, read-only** → B1 (readOnly data), B2 (readOnly canvas),
  B5 (page wiring). ✓
- **Run overlay (status + loop rounds)** → B3 (`buildRunStateMap`) + B5 (`buildData.run`). ✓
- **Legacy runs List-only** → B5 Step 1. ✓
- **Delete both legacy renderers, keep helpers** → B5 Step 3 + Global Constraints. ✓
- **Preserve List/Compare/Export/Branch** → B5 Steps 2/4. ✓
- **Open decisions:** none — report is a sink (no output socket); legacy = List-only; both settled
  in the design's §3.
- **Placeholder scan:** the only intentionally-light spots are repetitive JSX in A5/B1 ("mirror
  GateNode", "gate each editable control") — logic-bearing code (sockets, executor, validate,
  overlay, page wiring) is given explicitly.
