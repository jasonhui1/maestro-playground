# Alternatives Considered & Phase 5 Backlog

**Date:** 2026-06-29
**Status:** Reference notes (not a plan)
**Context:** Captured at the end of the Phase 4 (visual chain editor) design/plan cycle. Records the cleaner-but-deferred solutions we consciously did *not* take, and a backlog of follow-on work, so future iterations don't re-derive them.

---

## 1. Cleaner alternatives we deferred

These were the "more elegant if we were greenfield" options. We chose simpler/cheaper paths for v1 under YAGNI and to stay filesystem-first and reuse-heavy. Listed best-first by how likely they are to be worth graduating to.

### 1.1 Inline-chain run (drop the save-then-run flush)
- **What we did (Phase 4 / Approach A):** `/api/run` reads the chain from disk by `chainName`; the editor must `flush()` the autosave before running so disk = canvas.
- **Cleaner alternative:** extend `POST /api/run` to accept an inline `chain` object (the live canvas graph), so a run never depends on a prior write. Removes the one deliberate coupling in the editor and the (small) flush-before-run race surface.
- **Cost / why deferred:** a server-contract change + a second run code path; the flush is cheap and gives a nice "you can't run something unsaved" guarantee. Graduate this if partial/preview runs (§2.1) need to run un-persisted graphs anyway.

### 1.2 Single editor reducer (`useReducer` + pure `applyEditorAction`)
- **What we did:** `ChainEditor` holds several `useState`s (nodes, edges, selection, runState…) and calls a manual `sync(nextNodes, nextEdges)` after each mutation to push serialized markdown into `useAutoSave`.
- **Cleaner alternative:** one `useReducer` over `{ nodes, edges, selection }` with a pure, `tsx`-testable `applyEditorAction(state, action)` (add/connect/move/delete/updateNode/addLoopZone). Centralizes the "serialize → autosave" side-effect in one place and makes undo/redo (§2.3) almost free.
- **Cost / why deferred:** the current inline callbacks are small and already delegate to the tested `editorOps`. Worth doing the moment the editor grows or undo/redo lands.

### 1.3 Standalone editor + structured save endpoint (Phase 4 Approach B, full form)
- **What we did:** persistence round-trips through `serializeChain` → existing `useAutoSave` → `PUT /api/workspace/chain/[slug]` (the same matter-based path every entity uses). The canvas serializes to markdown on every change.
- **Cleaner alternative:** a dedicated `/api/chain` endpoint that accepts structured `{nodes, edges, meta}` and serializes server-side; the client keeps a single structured representation and never round-trips through markdown text.
- **Cost / why deferred:** new server surface + diverges from the unified `matter.stringify` save used by agents/skills/templates. Only graduate if the markdown round-trip proves lossy or a bottleneck. (Note: the round-trip invariant test in `serializeChain` is the guard that this *isn't* lossy today.)

### 1.4 Loop zones as React Flow parent/child container nodes
- **What we did:** zones are an auto-drawn, non-interactive `ZoneFrame` rectangle behind nodes sharing a `zone` id; membership is data-driven via the `zone` field.
- **Cleaner alternative:** real React Flow parent/child nodes — drag a node into the container to set membership, native clipping/movement.
- **Cost / why deferred:** introduces parent/child coordinate spaces and a containment concept the data model (`ChainNode.zone` string) doesn't have; would need a migration and coordinate translation. The frame gives the Blender look without that complexity. Revisit if drag-into-zone membership (§2.6) becomes desired.

### 1.5 Separate layout sidecar file
- **What we did:** node `pos` is stored in the chain `.md` frontmatter (one file, hand-editable, no drift).
- **Cleaner alternative:** keep chain logic in the `.md` and node positions in a `chain.layout.json` sidecar, so frontmatter stays free of view concerns.
- **Cost / why deferred:** splits one chain across two files and risks drift; positions-in-frontmatter is simpler and matches filesystem-first. Only reconsider if layout metadata grows large (e.g., per-user layouts).

### 1.6 Validation → node mapping by structured issues (this one we *did* take, recorded for contrast)
- The naive path was to string-parse node ids out of `errors: string[]`. We instead extended `validateChain` to return `issues: ValidationIssue[]` with `nodeId`/`edge`/`zone`. This was the clean choice and is already in the Phase 4 plan — noting it so nobody "optimizes" back to string parsing.

---

## 2. Phase 5 backlog (unordered; pick per appetite)

### 2.1 Partial run / "run up to here"
Execute only the upstream subgraph of a selected node and show its output. The executor already accepts `startOutputs` (used for branch replay) — a partial run could reuse that plus a topo-truncation. Pairs naturally with §1.1 (inline-chain run) since a partial graph may be un-persisted.

### 2.2 Per-node preview iteration
A "preview from here" affordance on each node (depends on §2.1). The big payoff for the original "preview the output of any node" goal beyond whole-run streaming.

### 2.3 Undo/redo
A command/history stack over editor actions. Trivial if §1.2 (reducer) lands first — snapshot or invert actions.

### 2.4 Subgraph / nested-chain nodes
A node kind that references another chain, expanded/collapsed inline. Enables reuse and tames large graphs. Needs recursion handling in validate + executor and cycle detection across chains.

### 2.5 Multi-select + copy/paste
Box-select multiple nodes, move/duplicate/delete as a group. Mostly a React Flow + editorOps extension.

### 2.6 Drag-into-zone membership
Set a node's `zone` by dragging it into a zone frame (depends on either hit-testing the frame or §1.4 parent nodes).

### 2.7 Inline agent prompt editing
Peek/edit the selected agent's `.md` (prompt/model/outputs) from a side drawer in the chain editor, instead of switching files. Keeps authoring in one place; must not blur the "agents are their own files" boundary.

### 2.8 External-edit sync (file watch)
`chokidar` is already a dependency. Reflect on-disk edits (or another agent's writes) into the open graph live, with a merge/conflict story. Turns the editor into a true live view.

### 2.9 Author from templates in the editor
Spin up a new chain in graph mode from a `TemplateDef` (templates already exist as an entity type).

---

## 3. Pointers
- Phase 4 design: `docs/maestro/plans/2026-06-28-visual-chain-editor-design.md`
- Phase 4 plan: `docs/maestro/plans/2026-06-28-visual-chain-editor-impl-plan.md`
- Prior phases: run-trace graph, chain DAG (Model B), control-flow nodes (3a-1), loop zones (3a-2) — same `docs/maestro/plans/` directory.
