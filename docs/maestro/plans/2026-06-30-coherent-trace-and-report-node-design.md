---
design_depth: standard
task_complexity: medium
topic: coherent-trace-and-report-node
date: 2026-06-30
---

# Design Document: Coherent Run Trace + Report (Display) Node

## 0. Context: residue of the Phase 1 → Phase 4 migration

The [run-trace graph](2026-06-28-run-trace-graph-design.md) was **Phase 1**: a deliberately
read-only, refs-based view that derived wires by parsing `{}` references from agents'
*current* `.md` files (Approach A). It explicitly deferred the central fork — *"does wiring
live in `{}` refs or in graph edges?"* — to Phases 2/3.

Phases 2–4 then moved the **authoring model** (chain DAG) and the **executor** to an explicit
**edge + slot** model: a chain is `nodes[] + edges[]`, slots are bare `{token}`s wired by
`ChainEdge`s, and `lib/executor.ts` walks that graph. The trace view never fully followed.
Today it still carries:

- **`buildRunGraph`** ([lib/graph.ts](../../../lib/graph.ts)) — the stale Phase-1 refs renderer.
  It reads a no-dot `{previous}` as a *context file named "previous,"* the opposite of what
  the slot model ([lib/slots.ts](../../../lib/slots.ts)) means. Live only for runs without a
  saved graph.
- **`buildRunGraphFromSnapshot`** ([lib/graph.ts](../../../lib/graph.ts)) — a thin adapter that
  reads the saved `run.graph` but **flattens** every non-source kind to a generic `agent` box
  (loop-start/loop-end/decider/gate/branch all collapse), drops **zones**, ignores saved
  **positions** (re-runs dagre), and loses **`until`/`maxIterations`**.

So the same chain looks different in the editor vs. history, and there is no terminal/output
node — forcing users to bolt an LLM agent onto the end as a pseudo-report.

This work finishes the migration on the trace side and adds the missing node.

## 1. Problem Statement

Three coupled incoherences, all observable in run `2026-06-29-S0V_E1` (the `refine-loop`
"rainbow" run):

### 1a. The "last agent didn't get its input"
The final `report` node uses agent `normal-handler`
([workspace/agents/normal-handler.md](../../../workspace/agents/normal-handler.md)), whose
body is `Handle this routine request at a normal pace:\n{in}`. The executor *did* deliver the
draft — `le.draft → report.in` resolved correctly and the draft is present verbatim in the
node's `systemPrompt` in [meta.json](../../../workspace/logs/2026-06-29-S0V_E1/meta.json).

But `normal-handler` is a **triage-chain agent**, authored to answer a *fresh request*. Handed
an already-finished essay (with its own `## Summary`) plus the executor's hardcoded user turn
`"Follow your instructions."` ([executor.ts:95](../../../lib/executor.ts)), the model had no
real task and produced meta-commentary ("Constraint Compliance Verification") — a 67-second
model call that ignored the content. To a user this reads as *"the last node didn't get the
input."* Root cause: **a terminal display step was implemented as an LLM agent with a
mismatched role.**

### 1b. History graph ≠ chain-editor graph
Two separate renderers with different node vocabularies (see §0). `refine-loop` —
`seed → [refine zone: ls → patch → review → le] → report` in the editor — renders in history as
a flat dagre row of look-alike boxes with the loop boundary and zone erased.

### 1c. No terminal/output node kind
`ChainNodeKind` ([lib/types.ts](../../../lib/types.ts)) has no passive sink. The only way to
"show the final result" is an `agent` node, which always costs a model call and can mangle the
output (1a).

**Rationale**:
- **One source of truth for node visuals** — *a chain should look identical wherever it is drawn.*
- **A display is not a model call** — *presenting a finished value must not re-invoke an LLM.*
- **Delete the dead fork** — *remove the stale refs renderer so only the edge/slot model remains.*

## 2. Requirements

### Functional
- **Report (display) node** — *A new `report` node kind: one input socket `in`, no outputs, no
  model call. Its run output is its input value, verbatim. Available in the node palette; renders
  in the editor and in history; its content is shown in the preview panel.*
- **Unified history graph** — *The Graph view on `/history/[runId]` renders `run.graph` using the
  same React Flow node components, `ZoneFrame`s, and saved positions as the chain editor, in a
  read-only mode. Loop-start/loop-end/decider/gate/branch/subchain/report all render as
  themselves.*
- **Run overlay** — *Each node shows its run status (success / error / skipped) and loop nodes
  show round count, sourced from `run.agentOutputs`. Clicking a node opens the existing preview
  panel for that node (multi-round aware).*
- **Preserve existing run-page features** — *List view, Compare outputs, Export (.md/.json), and
  Branch-from-here continue to work.*

### Non-Functional
- **One renderer / one vocabulary** — *Retire `buildRunGraph`, `buildRunGraphFromSnapshot`, and
  the `components/trace/` node set. History reuses editor components.*
- **Read-only safety** — *History must not allow editing the graph (no drag-to-wire, no delete,
  no node-field edits, no "▶ here").*
- **Style consistency** — *Existing zinc/white Tailwind + Lucide aesthetic; reuse `ZoneFrame`.*
- **Pure, testable core** — *The `report` passthrough, socket derivation, validation, and the
  `agentOutputs → RunStateMap` fold are pure functions with unit tests (tsx runner, as in prior
  phases).*

### Constraints
- **New runs only for the Graph view.** *Every run since the DAG model persists
  `graph: { nodes, edges }` ([app/api/run/route.ts:48](../../../app/api/run/route.ts)). Legacy
  runs (pre-DAG, e.g. `2026-04-*`) have no snapshot and **show the List view only** — the Graph
  toggle is hidden for them. This lets us delete both old renderers outright.*
- **Stack skills.** *Implementer must read `.agents/skills/xyflow12.md` (v12 is rebranded
  `@xyflow/react`, named exports, `readOnly` via `nodesDraggable`/`nodesConnectable`/
  `elementsSelectable`) and `.agents/skills/nextjs16.md` before touching canvas / App Router code.*

## 3. Decisions settled (from the requirements review)
1. **Report node = passive passthrough sink** (no LLM, no output socket). *Chosen over a
   templated formatter or a "fix the prompt on an agent" approach.*
2. **Unify by reusing the editor's node components in a read-only canvas** (not by extending the
   separate trace renderer). *Guarantees parity and lets us delete the trace renderer.*
3. **Legacy runs → List only.** *Simplest; both old renderers are removed now.*

## 4. Architecture & Data Flow

### Before
```
/history/[runId]
  run.graph ? buildRunGraphFromSnapshot(run)   // flattens vocab, drops zones/positions
            : buildRunGraph(run, agents)        // stale refs model ({previous} => file)
          ──► RunGraph (components/trace/*, dagre) ──► RunNodePreview
```

### After
```
/history/[runId]
  run.graph ? read-only ChainCanvas( run.graph.nodes, run.graph.edges,
                                     buildData = node → EditorNodeData{ run: overlay, readOnly } )
                                                                  // SAME components as the editor
            : List view only (no Graph toggle)
          ──► node click ──► RunNodePreview (by nodeId, multi-round)

overlay = buildRunStateMap(run.agentOutputs)   // pure fold, mirrors lib/runState.applyRunEvent
```

### Report node execution
```
report node ── in ◄── (wired source)
  executor: value = inValue(node)            // same helper gate/branch already use
            controlOutput(node.id, 'report', value, 'success')   // NO runFn / model call
```

### Key components
- **`lib/types.ts` (modified)** — `ChainNodeKind` gains `'report'`.
- **`lib/nodeSockets.ts` (modified)** — `report` → inputs `['in']`, outputs `[]`.
- **`lib/executor.ts` (modified)** — `usedSlots` + a `report` branch (passthrough, no `runFn`).
- **`lib/chainGraph.ts` (modified)** — `validateChain`: allow `report`, accept its `in` input,
  warn if unwired; `report` has no outputs so any out-edge is naturally flagged (terminal).
- **`components/editor/nodes/ReportNode.tsx` (new)** — mirrors `GateNode` minus the editable
  condition and the output handle; document icon; status dot; shows a short passthrough preview.
- **`components/editor/ChainCanvas.tsx` (modified)** — register `report`; add a `readOnly` prop.
- **`components/editor/NodePalette.tsx` (modified)** — add a `Report` item (group `Output`).
- **`components/editor/nodeData.ts` (modified)** — `EditorNodeData` gains `readOnly?: boolean`;
  node components disable their controls / hide "▶ here" when set.
- **`lib/runHistoryState.ts` (new, pure)** — `buildRunStateMap(agentOutputs): RunStateMap`.
- **`app/history/[runId]/page.tsx` (modified)** — render the read-only canvas for snapshot runs;
  List-only for legacy; node-click → `RunNodePreview`.
- **`components/trace/RunNodePreview.tsx` (modified)** — accept the selected `ChainNode` (it
  already resolves outputs by `nodeId`).
- **Deleted** — `lib/graph.ts` `buildRunGraph` + `buildRunGraphFromSnapshot`; `components/trace/`
  `RunGraph.tsx`, `TraceAgentNode.tsx`, `SeedNode.tsx`, `ContextNode.tsx`. **Kept**: `slugify`,
  `extractSection`, `extractSections` in `lib/graph.ts` (imported by executor/resolveNode/nodeSockets).

## 5. Data Structures

```ts
// lib/types.ts
export type ChainNodeKind =
  | 'seed' | 'context' | 'agent' | 'gate' | 'branch' | 'decider'
  | 'loop-start' | 'loop-end' | 'subchain' | 'report'   // + report

// lib/nodeSockets.ts
inputSocketsOf(report)  => ['in']
outputSocketsOf(report) => []          // terminal sink

// components/editor/nodeData.ts
export interface EditorNodeData {
  /* …existing… */
  readOnly?: boolean                   // history view sets true; editor leaves undefined
}

// lib/runHistoryState.ts  (mirrors lib/runState.NodeRunState)
export function buildRunStateMap(outputs: AgentOutput[]): RunStateMap
//   keyed by AgentOutput.nodeId; folds loop rounds into rounds[]; status from AgentOutput.status
```

### Worked example — the rainbow run, before vs after (report node)
```
BEFORE  report = normal-handler (agent)
  le.draft ──► report.in   → 67,474 ms model call
  output: "# Constraint Compliance Verification …"   (ignores the draft)

AFTER   report = report (sink)
  le.draft ──► report.in   → 0 ms, $0
  output: "# 為什麼彩虹有七種顏色？ … ## Summary …"   (the draft, verbatim — the final result)
```
Symptom 1a disappears: there is no agent left to misread the draft, and the preview panel shows
exactly the value the node received.

## 6. The report node semantics

A `report` node is **an always-pass gate that displays**. The executor already passes a value
through untouched for `gate` (`controlOutput(nodeId, …, pass ? inValue(nodeId) : '', 'success')`,
[executor.ts:235](../../../lib/executor.ts)). `report` is that minus the condition and minus the
output socket:

```ts
} else if (node.kind === 'report') {
  const rec = controlOutput(nodeId, 'report', inValue(nodeId), 'success')
  nodeOutputs.set(nodeId, rec); results.push(rec); callbacks.onDone(nodeId, rec)
  // terminal: no markOut needed (no out-edges), but harmless if added
}
```

`usedSlots(report) => ['in']` so the existing availability gate
([executor.ts:221](../../../lib/executor.ts)) records it `skipped` when its input is unwired,
exactly like gate/branch.

**Why a sink (no output socket)?** It matches "just display the report" and makes any downstream
wire a validation error (a report is terminal). If chain-level output wiring from a report is
later wanted, adding a passthrough `output` socket is a one-line change (mirror gate); deferred
under YAGNI.

## 7. The unified trace

### 7.1 Read-only canvas
History renders the **same** `ChainCanvas` as the editor, fed by `run.graph.nodes/edges`, with a
new `readOnly` prop that:
- sets `nodesDraggable={false}`, `nodesConnectable={false}`, `elementsSelectable` kept (for
  click-to-select), and omits the `onConnect` / `onNodesDelete` / `onEdgesDelete` handlers;
- still draws `ZoneFrame`s and uses saved `pos` (no dagre needed — the snapshot has positions).

`buildData(node)` returns an `EditorNodeData` with `run` = the overlay entry, `readOnly: true`,
no-op `onChange`, and no `onRunFromHere`. Each node component, when `data.readOnly`, renders its
fields as static/`disabled` and hides "▶ here". The node components already render
`statusDotClass(run)`, so status dots come for free.

### 7.2 Run overlay
`buildRunStateMap(run.agentOutputs)` folds outputs into a `RunStateMap` keyed by `nodeId`,
accumulating `rounds[]` for loop-body nodes (mirrors `applyRunEvent`'s `agent_done` case). This is
the same shape the live editor run uses, so the components need no new data contract.

### 7.3 Preview
`RunNodePreview` already resolves a node's outputs by `nodeId`
(`run.agentOutputs.filter(o => o.nodeId === node.id)`) and is multi-round aware. It is adapted to
take the selected `ChainNode` (it only needs `id`, `kind`, `file`/label) instead of a `TraceNode`.

### 7.4 Legacy runs
If `!run.graph`, the page hides the Graph toggle and renders the List view only. No legacy
renderer is kept.

## 8. Testing
- **`tests/report-executor.test.ts`** — a chain `seed → report` (input wired): the report node's
  output equals the seed value; `status === 'success'`; no model call (runFn spy not invoked for
  it). Unwired report → `skipped`.
- **`tests/report-sockets.test.ts`** — `inputSocketsOf(report) === ['in']`,
  `outputSocketsOf(report) === []`.
- **`tests/report-validate.test.ts`** — report accepted as a kind; out-edge from report flagged;
  unwired report warns; valid wired report passes.
- **`tests/serializeChain.test.ts`** (extend) — a `report` node round-trips through
  serialize → parse unchanged.
- **`tests/runHistoryState.test.ts`** — `buildRunStateMap`: single node → success; loop node with
  two `round`s → `rounds.length === 2`; error/skipped statuses preserved.
- **UI (manual)** — open `2026-06-29-S0V_E1`: graph matches the editor (zone frame, loop nodes,
  report node); clicking the report node shows the rainbow draft; List/Compare/Export/Branch
  unchanged; open a `2026-04-*` run: List only, no Graph toggle.

## 9. Out of scope (deferred)
- Editing the graph from history (it is read-only by design).
- A pass-through `output` socket on `report` / declaring a report as a chain output.
- Templated multi-input report formatting (rejected in favor of the passthrough sink).
- Back-filling a `graph` snapshot onto legacy runs.
- Any change to `lib/runner.ts` / `lib/logger.ts` (the report node is pure-executor).

## 10. Risk Assessment
- **Read-only leakage.** *A node component might still mutate on `readOnly`. Mitigated by gating
  every editable control and "▶ here" on `!data.readOnly`, and by `nodesConnectable={false}`.*
- **Overlay key mismatch.** *Loop bodies emit multiple outputs but one `nodeId`; the fold must
  accumulate rounds, not overwrite. Covered by `runHistoryState` tests.*
- **Deleting `buildRunGraph` breaks an import.** *`lib/graph.ts` also exports `slugify` /
  `extractSection(s)` used by executor/resolveNode/nodeSockets — keep those; only remove the two
  builder fns + trace-only types. Verify with a repo-wide grep before deleting.*
- **Report serialization.** *`serializeNode`'s switch has no `report` case and therefore emits
  only `{id, kind, pos, zone}` — which is exactly right (no extra fields). Guarded by the
  round-trip test.*

## 11. Success Criteria
- [ ] `report` is a selectable node kind; placing one and wiring `X → report.in` runs with **no
      model call** and the report's output equals its input.
- [ ] `refine-loop` in history renders identically to the chain editor (zone frame, loop-start/
      loop-end, report node), using saved positions.
- [ ] Per-node status dots + loop round counts show from the run; clicking any node previews its
      real output (multi-round aware); Branch/Compare/Export/List unchanged.
- [ ] Legacy (`run.graph`-less) runs show List only, no Graph toggle, no crash.
- [ ] `buildRunGraph`, `buildRunGraphFromSnapshot`, and `components/trace/{RunGraph,TraceAgentNode,
      SeedNode,ContextNode}.tsx` are deleted; `slugify`/`extractSection(s)` remain.
- [ ] All new unit tests pass; `tsc --noEmit`, `lint`, and `build` are clean.
