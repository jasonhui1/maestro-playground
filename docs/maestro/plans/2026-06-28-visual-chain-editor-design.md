# Phase 4 — Visual Chain Editor Design

**Date:** 2026-06-28
**Status:** Approved (design); implementation plan pending
**Depends on:** Phase 1 (run trace graph), Phase 2 (chain DAG / Model B), Phase 3a-1 (gate/branch/decider + conditions), Phase 3a-2 (loop zones) — all implemented.

## 1. Goal, scope & non-goals

**Goal:** A Blender-style node editor for chains — drag nodes from a palette, wire
sockets, edit each node's config inline in its body, see validation live, and **run
in-canvas with outputs streaming onto the nodes**. Chains remain plain `.md` files;
the editor is a view over them, not a new storage format.

### In scope (v1)

- A **Graph / YAML** toggle on the chain workspace page; Graph is the default for chains.
- All 8 node kinds creatable (categorized + searchable palette) and **editable inline on the node**.
- Drag to move (positions persist as `pos`), drag-between-handles to wire, delete nodes/edges.
- Auto-drawn labelled **loop-zone frames** (derived from the `zone` field).
- **Debounced autosave** round-tripping the graph back to the chain `.md`.
- **Run in-editor**: save-then-run, live per-node status + streamed output, click-to-expand preview.
- **Live validation**: inline node/edge markers + a summary panel.

### Non-goals (later phases)

- Partial "run up to here" / per-node preview (needs partial-run plumbing in the executor).
- Undo/redo history UI; multi-select box drag.
- Subgraph / nested-chain nodes.
- Editing agent prompts / models / declared outputs from inside the chain editor — those
  stay in the agent `.md` file.
- Drag-a-node-into-a-frame loop membership — membership stays data-driven via the `zone`
  field.

## 2. Architecture & file structure

Chosen approach (of three considered): **reuse the existing save / run / validate
infrastructure**. The editor is a new interactive view; it adds one new lib primitive
(`serializeChain`) and UI, and requires **no new server routes**. The alternatives —
(B) standalone editor with new `/api/chain` structured-save + inline-chain run, and
(C) making the read-only `RunGraph` editable — were rejected as, respectively,
unnecessary server surface for v1 and incapable of full inline editing.

### New — pure lib

- `lib/serializeChain.ts` — `serializeChain(meta, nodes, edges): string`. The inverse of
  `parseChain`: emits frontmatter `{ name, description, nodes, edges }` plus an empty body
  via `matter.stringify`. Pure and unit-testable with `tsx`.
- `lib/runStream.ts` — `streamRun(body, handlers)`. Extracts the SSE read/parse loop
  (`agent_start` / `token` / `agent_done` / `error` / `run_complete`) currently inline in
  `app/workspace/page.tsx` so the console and the editor share one parser.

### New — UI (`components/editor/`)

- `ChainEditor.tsx` — container: owns controlled nodes/edges state and the ephemeral
  run-state map, wires autosave + run + validation, renders canvas + palette + validation
  panel + preview panel.
- `ChainCanvas.tsx` — the React Flow surface: controlled `nodes` / `edges`,
  `onNodesChange` / `onEdgesChange` / `onConnect` / `onNodeDragStop`, background, controls,
  and the zone-frame layer. Manual positions; **no** dagre on every render.
- `nodes/` — editable node components, one per kind (agent + decider share one):
  `SeedNode`, `ContextNode`, `AgentNode`, `GateNode`, `BranchNode`, `LoopStartNode`,
  `LoopEndNode`. Reuse the handle/socket styling from `components/trace/TraceAgentNode.tsx`.
- `ZoneFrame.tsx` — a non-interactive custom node sized to the bounding box of its `zone`
  members, rendered behind them; recomputed when members move.
- `NodePalette.tsx` — categorized groups (Sources / Agents / Control flow / Loop) + a
  filter box; click- or drag-to-add.
- `ValidationPanel.tsx` — lists structured issues; clicking one selects the offending
  node/edge.

### New — hook

- `hooks/useChainEditor.ts` — holds nodes/edges, exposes add/remove/connect + change
  appliers, derives the serialized markdown, feeds it into the (extended) `useAutoSave`,
  and exposes `run()`.

### Modified

- `lib/chainGraph.ts` + `lib/types.ts` — `validateChain` additionally returns
  `issues: ValidationIssue[]`; existing `errors: string[]` kept verbatim so `/api/run`
  is untouched.
- `hooks/useAutoSave.ts` — add a `flush()` that cancels the pending debounce timer and
  awaits a single `PUT` (used by save-then-run).
- `app/workspace/page.tsx` — add the Graph / YAML toggle for `type === 'chain'`; render
  `<ChainEditor>` in Graph mode, the existing `FileEditor` in YAML mode.

### Reused unchanged

`PUT /api/workspace/[type]/[slug]`, `POST /api/run` + SSE, `useAutoSave` core,
`parseChain`, `validateChain` core, the executor, `GET /api/workspace`.

## 3. Persistence & the serialization round-trip

The canvas is the source of truth while in Graph mode; every change is serialized back to
the chain `.md` so the file and the canvas never diverge.

### Write path (canvas → disk)

1. A change handler updates nodes/edges in `useChainEditor`.
2. The hook derives a markdown string via `serializeChain(meta, nodes, edges)`.
3. That string is handed to `useAutoSave` (the existing 2s-debounced hook), which re-parses
   it with `matter()` and `PUT`s `{ data, content }` to `/api/workspace/chain/[slug]` — the
   **same path** every other entity uses. No new save endpoint.

### `serializeChain` contract (inverse of `parseChain`)

- Frontmatter `data = { name, description, nodes, edges }`; body is empty (chains keep
  everything in frontmatter).
- Each node serializes only the fields relevant to its kind (**no `undefined` keys**):
  `id`, `kind` always; `pos` always (so layout persists); plus, per kind:
  - agent / decider: `agent`
  - context: `file`
  - gate: `condition`
  - branch: `cases`, `default`
  - loop-start: `zone`, `state`
  - loop-end: `zone`, `until`, `maxIterations`
- Edges serialize as `{ from, to }` **strings**. `from` collapses to `"node"` when the
  socket is `output`, else `"node.socket"`; `to` is always `"node.socket"` (input sockets
  are never `output`). This matches `parseEndpoint` exactly.

### Round-trip invariant (key unit test)

For any chain `c`, `parseChainContent(serializeChain(c.meta, c.nodes, c.edges), c.slug)`
deep-equals `c` (modulo key order). Tested with `tsx` against the example chains
(`story-chain`, `triage-demo`, `refine-loop`).

### Position seeding

A chain authored in YAML may have nodes without `pos`. On first load into Graph mode, any
node missing `pos` is assigned one via a single dagre pass (LR, reusing the layout logic
from `RunGraph`); the next autosave writes those positions back, and dagre never runs again
unless the user clicks "Tidy layout."

### Concurrency

YAML mode and Graph mode are mutually exclusive views of the same file, switched by the
toggle; only one is mounted at a time, so there is no dual-writer race. Switching to YAML
flushes any pending graph save first.

## 4. Canvas & inline editing model

### Node bodies (Blender-style, inline)

Each kind renders its own fields in the node body; sockets are handles on the sides.

| Kind | Inline fields | Input handles | Output handles |
|---|---|---|---|
| seed | — | — | `output` |
| context | file dropdown (from `GET /api/workspace` → context) | — | `output` |
| agent | agent dropdown | one per prompt `{slot}` of chosen agent | `output` + declared `outputs` |
| decider | agent dropdown | same as agent | `output` + declared `outputs` |
| gate | condition text input | `in` | `output` |
| branch | inline case rows (label + condition, add/remove) + `default` label | `in` | one per case label (+ default) |
| loop-start | `zone` id + `state` list (add/remove names) | one per state name | one per state name |
| loop-end | `zone` id + `until` + `maxIterations` | one per state name | one per state name |

Input handles for agent/decider are **derived live** from the selected agent's prompt slots
(`parseSlots`) and declared `outputs` (fetched once from `GET /api/workspace`), so changing
the agent re-flows the sockets. Editing an agent's prompt/model still happens in the agent
`.md` — out of scope here.

### Wiring

Drag from a source handle to a target handle calls `onConnect`, which adds a `ChainEdge`.
The one-incoming-edge-per-input rule (from `validateChain`) is enforced at connect time:
connecting to an occupied input replaces the old edge. Self-loops and edges into kinds with
no inputs are rejected at connect time (cheap pre-checks); everything deeper is left to live
validation (Section 6).

### Palette

Categorized groups — **Sources** (seed, context), **Agents** (agent, decider),
**Control flow** (gate, branch), **Loop** (loop zone) — with a filter box. Click or drag to
add a node at a sensible position with a generated unique `id` (kind + counter). "Add loop
zone" is one action that inserts a **paired** loop-start + loop-end sharing a freshly
generated `zone` id.

### Loop-zone frame

A `ZoneFrame` is drawn as a non-interactive node behind every group of nodes sharing a
`zone` id, sized to their bounding box with the zone id as a label. It is purely visual and
derived — membership lives in each node's `zone` field, never in the frame. It recomputes on
member drag. Assigning a node to a zone in v1 is done via its inline `zone` field / the loop
nodes; drag-into-frame membership is a non-goal.

### Delete

Selecting a node + delete removes it and its incident edges. Deleting one half of a loop
pair is allowed but raises the zone-pairing validation issue (Section 6) rather than
corrupting state.

## 5. Run & live previews

### Save-then-run

`/api/run` reads the chain from disk by `chainName`, so Run must guarantee disk = canvas:

1. `run()` calls `useAutoSave.flush()` — forces the pending debounced save and awaits the `PUT`.
2. It then `POST`s `/api/run { chainName: slug, seedPrompt }` and consumes the stream via
   the shared `streamRun` helper.

The seed prompt uses the same input affordance the console already has (a seed-prompt box in
the editor toolbar/panel).

### Streaming onto nodes

Every SSE event carries `nodeId`, so `streamRun` handlers map directly onto canvas nodes via
a per-node **run-state map** kept in `ChainEditor` (separate from the graph itself, so
running never mutates the saved structure):

- `agent_start` → node enters `running` (pulsing accent, matching `TraceAgentNode` status dot).
- `token` → append to that node's live output buffer (shown truncated in the node body;
  thought tokens kept separately).
- `agent_done` → node shows final `status` (`success` / `error` / `skipped`); skipped nodes
  grey out and dim, reusing the styling already in `TraceAgentNode`.
- For loop-zone nodes, `round` on the output groups output per iteration (latest shown on
  the node, all rounds in the preview panel) — same convention `RunNodePreview` uses.
- `run_complete` clears the running flags; `error` marks the run failed and surfaces the message.

### Preview panel

Clicking a node opens the existing-style bottom preview panel (porting `RunNodePreview`'s
rendering) showing that node's full output, per-round for loop bodies. Selecting another node
swaps content. The panel reads from the live run-state map, so it updates mid-run.

### Run state is ephemeral

Run state lives only in editor memory; the canonical persisted run trace is still written by
`/api/run` to the run dir (unchanged) and remains viewable in the history page. The editor
does not duplicate run persistence.

## 6. Validation

`validateChain` is extended to return structured `issues: ValidationIssue[]` alongside the
existing `errors: string[]` (kept verbatim so `/api/run` is untouched).

```ts
interface ValidationIssue {
  message: string
  severity: 'error'
  nodeId?: string
  edge?: { fromNode: string; fromSocket: string; toNode: string; toSocket: string }
  zone?: string
}
```

Each existing error push gets a structured counterpart carrying the id it already names in
its message (node id, edge endpoints, or zone id).

- **When:** re-run on every graph change (debounced ~150ms), client-side, against the live
  nodes/edges + the agent defs already fetched.
- **Inline:** nodes/edges with an issue get a red outline + a badge with the count; hovering
  shows the messages. Reuses the amber/red socket states already present in `TraceAgentNode`
  for unresolved/undeclared sockets.
- **Summary:** `ValidationPanel` lists all issues; clicking one selects and centers the
  offending node/edge.
- **Run gating:** Run is enabled even with issues (the server re-validates and returns 400
  with the error list, which we surface) — but the button shows the issue count so the user
  knows it will likely fail. The server stays the gatekeeper; the client does not
  hard-disable, to keep the loop fast.

## 7. Error handling & edge cases

- **Unparseable chain (hand-edited externally):** Graph mode shows a non-blocking banner
  ("couldn't parse this chain as a graph — edit in YAML") and falls back to YAML mode rather
  than rendering a broken canvas.
- **Save failure (`PUT` non-200):** surfaced via the existing `useAutoSave` error state
  (already wired to a status indicator); the canvas keeps the in-memory edits so nothing is
  lost.
- **Run on an unsaved/invalid chain:** `flush()` runs first; if the server returns 400
  (invalid), show the returned `errors` in the validation panel and abort the run.
- **Agent referenced by a node but missing/renamed:** node renders in a "def missing" state
  (already a concept in `TraceAgentNode`) and raises a validation issue; its derived sockets
  fall back to empty.
- **Deleting one half of a loop pair:** allowed, but raises the zone-pairing validation issue
  rather than corrupting state.
- **Concurrent debounced save + manual flush:** `flush()` cancels the pending timer and
  awaits a single `PUT` to avoid double writes.
- **New node with no `pos`:** assigned the drop point (palette) or a dagre-seeded position
  (YAML import).

## 8. Testing strategy

The project's testing is logic-first via `tsx` (`npx tsx tests/<name>.test.ts`); heavy
RTL/E2E is a non-goal.

- **`serializeChain` (unit):** round-trip invariant against `story-chain`, `triage-demo`,
  `refine-loop`; edge socket-collapsing (`output` omitted, named sockets kept); per-kind
  field emission (no `undefined` keys); empty chain.
- **`validateChain` structured issues (unit):** each error category also yields an issue with
  the correct `nodeId` / `edge` / `zone`; the `errors` string list is unchanged (existing
  tests stay green).
- **`runStream` (unit):** feed a synthetic SSE byte stream (including a frame split across
  chunks) and assert handler calls — locking the parser both the console and editor depend on.
- **Component (light):** node components render the right fields per kind and emit change
  events; palette "Add loop zone" inserts the loop pair with a shared zone id.
- **Manual smoke:** author a small chain from scratch in Graph mode, run it, watch live
  previews, reload to confirm round-trip persistence.

## Summary of decisions

| Decision | Choice |
|---|---|
| Architecture | Reuse save/run/validate; new view + `serializeChain`; no new server routes |
| Scope | Authoring core + live run previews |
| Editable kinds | All 8 |
| Config editing | Inline on the node (Blender-style) |
| Persistence | Round-trip to the chain `.md` (`pos` in frontmatter) |
| Save trigger | Debounced autosave (reuse `useAutoSave`) + `flush()` for save-then-run |
| Live preview | Run in-editor; stream tokens onto nodes; click to expand |
| Loop zones | Auto-drawn labelled frame; membership data-driven via `zone` |
| Palette | Categorized groups + search |
| Validation | Inline on nodes/edges + summary panel; server stays gatekeeper |
