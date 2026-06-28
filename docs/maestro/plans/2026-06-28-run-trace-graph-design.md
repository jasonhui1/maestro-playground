---
design_depth: standard
task_complexity: medium
topic: run-trace-graph
date: 2026-06-28
---

# Design Document: Run Trace Graph with Output Previews (Node Graph — Phase 1)

## 0. Context: the bigger arc

This is **Phase 1** of a larger re-architecture toward a Blender-style node graph for chains
(multi-input/multi-output nodes, with previewable outputs). The full arc is decomposed into four
phases so each ships independently:

1. **Phase 1 (this doc)** — Visualize the *real* data-flow graph and preview any node's output, on
   the run trace view. **Read-only. No changes to the resolver, runner, or logger.**
2. **Phase 2** — Promote the chain file from a flat `agents: [...]` list to a nodes + edges DAG that
   is still human-readable and backward-compatible.
3. **Phase 3** — Topological execution engine: multi-input merge, optional parallelism, control nodes.
4. **Phase 4** — Editable node UI (drag-to-wire sockets) with live previews; edges become a source of truth.

Phase 1 deliberately sidesteps the central architectural fork ("does wiring live in `{}` refs or in
graph edges?") — that decision arrives in Phase 2/3.

## 1. Problem Statement

The current chain model is a **linear list pretending to be a graph**. A chain is just
`agents: [a, b, c]` ([`lib/fs/parseChain.ts`](../../../lib/fs/parseChain.ts)); the visual builder
renders it top-to-bottom with single input/output handles. The *real* data wiring is invisible — it
lives inside prompt text via the `{}` resolver ([`lib/resolver.ts`](../../../lib/resolver.ts)), which
lets any agent pull `{input}`, `{agent.output}`, `{agent.summary}`, or `{file}`.

Two consequences:
- **Multiple inputs already exist but are hidden.** An agent whose prompt references
  `{world-builder.summary}` and `{input}` is already a 2-input node — the graph just never draws it.
- **There is no way to click a node and see its output.** Run data exists
  ([`app/history/[runId]/page.tsx`](../../../app/history/[runId]/page.tsx) loads every step's
  `input`/`output`/`thought`/tokens) but is only shown as a flat vertical card list.

**Rationale**:
- **Observability** — *Make the true data-flow visible and let the user inspect any node's real output.*
- **De-risk the direction** — *Validate the node-graph look/feel before committing to the heavier
  data-model and execution rewrites in later phases.*
- **Zero waste** — *The ref parser written here is the same one a future run-time ref capture (Phase 2)
  will reuse.*

## 2. Requirements

### Functional Requirements
- **Graph view on the run trace** — *Add a Graph view to `/history/[runId]` via a `Graph | List`
  toggle. Graph is the default; List is today's card view, unchanged.*
- **Full data-flow graph** — *Nodes = agents + a Seed node + one node per referenced context file.
  Wires = exactly the `{}` references found in agent prompts.*
- **Multiple input sockets** — *Each agent node renders one labeled target handle per incoming wire
  (e.g. `input`, `.summary`, `lore.md`) — the Blender-style multi-socket look.*
- **Declared output sockets** — *Output sockets come from a new `outputs:` declaration in agent
  frontmatter (hybrid string-or-object form). `output` and `summary` are always implicitly present.*
- **Click-to-preview panel** — *Selecting a node opens a bottom docked, collapsible panel showing that
  node's data: agent → output + thought + token/cost + collapsible resolved prompt + Branch-from-here;
  seed → the run's seed prompt; context → file name (+ best-effort contents).*
- **Honest reconciliation flags** — *Built against a completed run: a referenced agent/output that
  didn't run/appear is flagged; a downstream ref to an undeclared output is flagged; a declared output
  missing from the actual text is flagged.*
- **Preserve existing features** — *Branch-from-here, Compare outputs (diff), and Export (.md/.json)
  continue to work; Branch is additionally available inside the graph's preview panel.*

### Non-Functional Requirements
- **Read-only & non-invasive** — *No changes to `lib/resolver.ts`, `lib/runner.ts`, or
  `lib/logger.ts`. Pure additive feature.*
- **Retroactive** — *Works on every existing run immediately (Approach A; see §3).*
- **Style consistency** — *Match the existing zinc/white, utilitarian Tailwind + Lucide aesthetic and
  reuse the existing dagre/React Flow setup. No dark "Blender" theme.*
- **Pure, testable core** — *Ref parsing and graph construction are pure functions with unit tests.*

### Constraints
- **Approach A (parse current agent definitions).** *Wires are derived by parsing `{}` refs from the
  agents' current `.md` files, because the run log stores only the **resolved** system prompt
  ([`lib/logger.ts`](../../../lib/logger.ts) line ~35) — refs are not recorded at run time.*
- **Mirror resolver semantics.** *Ref parsing must match how `lib/resolver.ts` interprets refs
  (no-dot ⇒ context file; `x.field` ⇒ agent field; first-prior-match for agent refs) so wires reflect
  reality.*
- **App Router conventions.** *Client-side graph construction; `buildRunGraph` is pure TS and could be
  moved server-side later if needed.*

## 3. The one technical decision (settled): where refs come from

**Approach A — parse current agent definitions (CHOSEN for Phase 1).** Build the graph by parsing
`{}` refs from the agents' current `.md` bodies (available via `/api/workspace`, which returns each
`AgentDef.systemPrompt` raw body), matched against the run's `agentOutputs`.

- Pure read; zero changes to the execution/logging path (keeps the resolver — "the heart" — untouched).
- Works retroactively on all existing runs.
- Known limitation: wires reflect agent files *as they are now*, not necessarily the version that ran.
  Mismatches are flagged (dangling ref ⇒ drop edge; referenced agent absent from run ⇒ "stale" node;
  agent that ran but whose def is now missing ⇒ "definition not found" badge, no derived in-wires).

**Approach B — capture refs at run time (PLANNED, future).** Add a `refs` field to `AgentOutput` and
record it in `runner.ts`/`logger.ts`; the graph reads refs from the log for perfect fidelity. Deferred
to Phase 2 (it touches the execution path and only benefits new runs). **The `lib/refs.ts` parser
written for Phase 1 is exactly what B will reuse — nothing is wasted.**

## 4. Architecture & Data Flow

```
/api/runs/[runId]  ──► RunMeta (agentOutputs: input/output/thought/tokens)  ┐
                                                                            ├─► buildRunGraph() (pure)
/api/workspace     ──► AgentDef[] (raw systemPrompt + declared outputs)     ┘            │
                                                                                         ▼
                                                              RunGraph (React Flow) ──► RunNodePreview (panel)
```

### Key Components
- **`lib/refs.ts` (new, pure)** — *`parseRefs(template)` extracts the `{}` references from a prompt
  body, mirroring resolver semantics. Field-agnostic for agent refs.*
- **`lib/graph.ts` (new, pure)** — *`buildRunGraph(run, agents)` turns a run + agent defs into a
  domain graph of `TraceNode[]` + `TraceEdge[]` (no React Flow types). Handles socket derivation and
  reconciliation flags.*
- **`components/RunGraph.tsx` (new)** — *React Flow rendering of the domain graph: dagre layout (TB
  default, LR toggle) reusing the helper pattern from
  [`ChainFlowBuilder.tsx`](../../../components/workspace/ChainFlowBuilder.tsx); node selection state;
  fit/center controls. Drag repositions for inspection only — not persisted.*
- **Node renderers (new)** — *`TraceAgentNode`, `SeedNode`, `ContextNode` in the current zinc/white
  style. Agent node renders multiple labeled target handles (one per input socket) on the left and
  source handles for declared outputs.*
- **`components/RunNodePreview.tsx` (new)** — *Bottom docked, collapsible preview panel. For agent
  nodes reuses existing [`AgentStreamOutput`](../../../components/AgentStreamOutput.tsx) (with
  `isStreaming:false`) and [`TokenCostBar`](../../../components/TokenCostBar.tsx).*
- **`app/history/[runId]/page.tsx` (modified)** — *Adds `viewMode: 'graph' | 'list'` (default graph),
  a header toggle, and one client fetch of `/api/workspace`. List/Compare/Export untouched.*
- **`lib/types.ts` (modified)** — *`AgentDef` gains `outputs: OutputSocketDef[]`; new graph types.*
- **`lib/fs/parseAgent.ts` (modified)** — *Read `data.outputs`, normalize hybrid string/object form,
  always include implicit `output` + `summary`.*

### Data Flow
1. Page fetches the run (`/api/runs/[runId]`) — existing.
2. Page also fetches agents (`/api/workspace`) — new.
3. `buildRunGraph(run, agents)` runs client-side → `{ nodes, edges }`.
4. `RunGraph` maps the domain graph to React Flow nodes/edges (assigning `sourceHandle`/`targetHandle`
   socket ids) and lays out with dagre.
5. Selecting a node sets `selectedNodeId`; `RunNodePreview` renders that node's slice of the run.
6. Branch-from-here in the preview reuses the existing branch POST flow with the node's `stepIndex`.

**Rationale**:
- **Pure core, thin UI** — *All graph logic lives in unit-tested pure functions; React components only
  render and select.*
- **Reuse over rebuild** — *dagre, React Flow, `AgentStreamOutput`, `TokenCostBar`, and the branch
  flow already exist; Phase 1 composes them.*

## 5. Data Structures

```ts
// lib/refs.ts — field-agnostic; mirrors resolver semantics
export type ParsedRef =
  | { kind: 'input' }                                   // {input}
  | { kind: 'agent'; target: string; field: string }   // {x.output} | {x.summary} | {x.anything}
  | { kind: 'file';  target: string }                  // {name} (no dot) ⇒ context/name.md
export function parseRefs(template: string): ParsedRef[]   // deduped

// lib/types.ts — declared output contract (hybrid form)
export interface OutputSocketDef {
  name: string
  type?: string          // 'markdown' | 'json' | 'number' | ... (freeform for now)
  description?: string
}
// AgentDef gains:  outputs: OutputSocketDef[]   // implicit 'output' + 'summary' always included

// lib/graph.ts — domain graph
export interface InputSocket  { id: string; label: string; ref: ParsedRef; unresolvedField?: boolean }
export interface OutputSocket { id: string; name: string; type?: string; present: boolean; consumed: boolean; undeclared?: boolean }
export interface TraceNode {
  id: string
  kind: 'seed' | 'agent' | 'context'
  label: string
  stepIndex?: number               // agent: index into run.agentOutputs
  agentName?: string
  status?: 'success' | 'error'
  defMissing?: boolean             // agent ran but its def is gone now
  stale?: boolean                  // referenced agent that didn't run in this run
  inputs?: InputSocket[]           // agent: derived from refs
  outputs?: OutputSocket[]         // agent: declared, reconciled with actual output
  fileName?: string                // context node
}
export interface TraceEdge {
  id: string
  source: string; sourceHandle: string   // producer output-socket id
  target: string; targetHandle: string   // consumer input-socket id
  kind: ParsedRef['kind']
  label: string
  flagged?: boolean                       // missing output / undeclared / dangling
}
export function buildRunGraph(run: RunMeta, agents: AgentDef[]): { nodes: TraceNode[]; edges: TraceEdge[] }
```

### Worked example: `parseRefs` → `buildRunGraph`
Given `character-designer`'s prompt body:

> "Using `{input}` and `{world-builder.summary}`, referencing `{lore}`, write the characters."

`parseRefs` returns three refs → three **input sockets** on the node:
```ts
[ { kind: 'input' },
  { kind: 'agent', target: 'world-builder', field: 'summary' },
  { kind: 'file',  target: 'lore' } ]
```
`buildRunGraph` then:
- creates the `character-designer` agent node with those three input sockets;
- wires `{input}` from the previous step (or the Seed node if it is step 0);
- wires `.summary` from the `world-builder` node's `summary` output socket (creating a stale
  `world-builder` node if it didn't run);
- wires `lore` from a `context-lore` node (created on demand).

## 6. The socket model

The model is intentionally **asymmetric**, and that asymmetry is correct:

- **Input sockets are *demand-driven*** — derived from the prompt's `{}` refs. A node's inputs are
  exactly what it consumes; always accurate, fully automatic.
- **Output sockets are *contract-driven*** — declared in the agent's frontmatter `outputs:`. This is
  the only way an output socket can be known *before a run* (an agent has no implicit output schema;
  `.summary` only works today because base-protocol *forces* a `## Summary` section). The same
  declaration carries forward to the Phase 4 editor unchanged.

`outputs:` accepts the **hybrid string-or-object** form:
```yaml
outputs:
  - summary                 # shorthand (string)
  - name: characters        # rich (object)
    type: json
    description: array of character objects
  - geography
```

### Reconciliation (Phase 1 is a completed run, so outputs exist on disk)
- declared **and** present in output → live socket (content previewable).
- declared but **missing** from output → flagged (the agent broke its contract).
- a downstream ref to an **undeclared** output → flagged (consumer wants something the producer never
  advertised).
- input ref whose field the current resolver can't satisfy (anything but `output`/`summary`) →
  socket shown with an "unsupported field" badge (scopes the future Layer-2 resolver work).

## 7. Testing

Pure functions get real unit tests, following the existing `tests/*.test.js` node-run pattern:
- **`tests/refs.test.js`** — `parseRefs`: `{input}`; `{x.output}`/`{x.summary}`/`{x.anything}`;
  no-dot file refs; multiple refs in one body; dedupe; malformed/empty braces.
- **`tests/graph.test.js`** — `buildRunGraph`: linear chain; fan-in (multi-input); context file nodes;
  Seed node shown only when `{input}` is consumed at step 0; stale node for referenced-but-didn't-run;
  duplicate agent names across steps; declared-vs-present-vs-referenced reconciliation flags;
  def-missing agent.

## 8. Out of scope for Phase 1 (deferred)
- Editing wires/nodes; persisting positions (drag is inspection-only).
- Live/streaming previews (Phase 4).
- Run-time ref capture — Approach B (Phase 2).
- New CONTROL / CALCULATION node *types* (Phase 3 execution concept).
- Layer-2 resolver work (actually *resolving* arbitrary output sections/properties).
- Editor output sockets without a run (the declared `outputs:` contract introduced here is the
  mechanism that will make this work in Phase 4).
- Any change to `lib/resolver.ts`, `lib/runner.ts`, `lib/logger.ts`.

## 9. Risk Assessment
- **Wire fidelity (Approach A).** *Wires reflect current agent defs, not the run's snapshot. Mitigated
  by explicit flags (stale node, def-missing, dangling edge) and resolved properly by Approach B later.*
- **Agent-name matching.** *Refs match agents by the resolver's rule (`AgentOutput.agentName` ==
  `AgentDef.name`). `buildRunGraph` must mirror this exactly, including first-prior-match for repeated
  names, or wires will point at the wrong node.*
- **Multi-handle layout.** *Many input sockets on one node can crowd the layout. Mitigated by compact
  labeled handles and dagre spacing; revisit if dense graphs look noisy.*
- **Regression on the run page.** *List/Compare/Export must remain byte-for-byte behavior. Mitigated by
  gating the graph behind a toggle and leaving the List branch untouched.*
- **`outputs:` frontmatter is a file-format addition.** *Backward-compatible: agents without `outputs:`
  fall back to implicit `output` + `summary` only.*

## 10. Success Criteria
- [ ] `/history/[runId]` shows a `Graph | List` toggle; Graph is default; List is unchanged.
- [ ] The graph renders agents + Seed + context nodes, with wires derived from `{}` refs.
- [ ] Agent nodes show multiple labeled input sockets (one per ref) and declared output sockets.
- [ ] Clicking any node opens the bottom preview panel with that node's real data.
- [ ] Branch-from-here works from the preview panel; Compare and Export still work.
- [ ] Stale / def-missing / undeclared-output / missing-output cases are visibly flagged.
- [ ] `parseRefs` and `buildRunGraph` pass their unit tests.
- [ ] No edits to `resolver.ts`, `runner.ts`, or `logger.ts`.
