# Phase 5 — Backlog Design (all items, grouped by ease)

**Date:** 2026-06-29
**Status:** Design (approved in brainstorm; pending spec review → impl plan)
**Context:** Phase 4 (visual chain editor) shipped. This designs the full Phase 5 backlog from `docs/maestro/plans/2026-06-29-alternatives-and-phase5-backlog.md`, organized into ease tiers (easy first). The two deferred §1.x refactors that other items depend on (§1.1 inline-chain run, §1.2 editor reducer) are graduated here **as enablers** of the items that need them, not as standalone work.

This is the umbrella design for the whole phase. Each group is designed to implementable depth so the impl plans can be sliced per group.

---

## 0. Scope, sequence, and cross-cutting changes

### In scope
All nine backlog items, plus §1.1 and §1.2 folded in as enablers:

- **Group A — Easy (editor-local; no executor/data-model change):** §2.5 multi-select + copy/paste, §2.7 inline agent prompt editing, §2.9 author chain from template.
- **Group B — Medium (touch executor or core editor state, bounded):** §1.1 inline-chain run, §1.2 editor reducer, §2.1 partial run, §2.2 per-node preview, §2.3 undo/redo, §2.6 drag-into-zone membership.
- **Group C — Hard (new architecture / recursion / conflict semantics):** §2.4 subgraph / nested-chain nodes, §2.8 external-edit file-watch sync.

### Build sequence
Group A (any order) → Group B (`§1.1`, `§1.2` first, then `§2.1 → §2.2`, then `§2.3`, then `§2.6`) → Group C (`§2.4` then `§2.8`).

### Cross-cutting signature changes (everything else is additive)
- `validateChain(chain, agents)` → `validateChain(chain, agents, chains)` — §2.4 needs the chain registry to resolve subchain refs.
- `runChainGraph(...)` gains a `chains` registry argument — §2.4 recursion.
- `POST /api/run` grows an inline-`chain` branch — §1.1.

### Conventions
- Tests are plain `node:assert` files run with `npx tsx tests/<file>`, ending `console.log('✅ … passed')` (no framework), matching the existing suite.
- Pure logic lives in `lib/*` and is unit-tested; React components stay thin and are verified manually. The recurring move below is **"extract the hard decision into a pure function so it's testable, keep the I/O plumbing thin."**

---

## Group A — Easy

### §2.5 — Multi-select + copy/paste

**Goal.** Box/shift-select multiple nodes; move, duplicate, delete, and copy/paste them as a group.

**Key decision — selection model.** One `selectedIds: string[]` in `ChainEditor` (replacing `selectedId`), with **primary = `selectedIds[0]`**. `NodePreview` and `ValidationPanel` keep operating on the primary, so their behavior is unchanged. Clipboard is **in-memory editor state** for v1 (not persisted, not cross-tab) — YAGNI on a system clipboard.

**Approach.** React Flow already does box-select and group-drag; we lift selection into editor state and add pure clipboard ops.

**Changes.**
- `lib/editorOps.ts` — two pure, tested functions:
  - `copySubgraph(nodes, edges, ids): { nodes, edges }` — selected nodes + **internal** edges only (both endpoints in `ids`).
  - `pasteSubgraph(clip, existingIds, offset): { nodes, edges, newIds }` — mints fresh ids via `uniqueNodeId`, builds an id-map, remaps edge `fromNode`/`toNode`, **mints a fresh `zone` id per distinct copied zone** (a pasted loop pair stays internally consistent), offsets `pos`, returns `newIds` to select.
- `components/editor/ChainCanvas.tsx` — `onSelectionChange` (push ids up), `multiSelectionKeyCode`/`selectionOnDrag`, `onSelectionDragStop` → new `onMoveMany(updates)` so group drags persist every node's `pos`. Render `selected` from membership in `selectedIds`.
- `components/editor/ChainEditor.tsx` — `selectedIds` state; `clipboard` state; `copy`/`paste`/`duplicate` handlers; a keydown listener (Ctrl/Cmd+C/V/D) **guarded to ignore events whose target is an `<input>`/`<textarea>`**; `onMoveMany`. Existing delete already fans out via `onNodesDelete`.

**Tests.** `tests/editor-ops.test.ts` additions: copy keeps only internal edges; paste produces no id collisions, remaps edges + zones, offsets `pos`, returns the new selection set.

**v1 caveat (documented, non-blocking).** Copying *part* of a loop zone yields an invalid pasted zone the user fixes (validation already flags it). Auto-expanding selection to whole-zone membership is deferred.

**§1.2 interaction.** When the reducer lands (Group B), `selectedIds` + `clipboard` fold into reducer state — a ~10-line migration, called out in §1.2.

---

### §2.7 — Inline agent prompt editing

**Goal.** Peek/edit the selected agent node's underlying `.md` without leaving the chain editor — without blurring "agents are their own files."

**Key decision — edit surface.** Reuse the **whole-file `FileEditor`** (frontmatter + body) in a drawer, not a bespoke prompt/model/outputs form. Zero new edit logic, and it is literally the same file you'd edit on the agent tab — the cleanest way to honor the boundary. (A structured mini-form was the alternative; rejected — re-implements an editor and risks divergence.)

**Approach.** A right-side `AgentDrawer` opens when the primary selection is an `agent`/`decider` node with a valid slug. It loads via the existing `GET /api/workspace/agent/[slug]` and saves through `useAutoSave('agent', slug, raw)` → existing `PUT`. No new server surface.

**Changes.**
- New `components/editor/AgentDrawer.tsx` — fetch raw `.md`, `useAutoSave`, render `FileEditor`; header shows the agent name + an **"Open full file →"** link (navigates to the agent tab, reinforcing the boundary).
- `components/editor/ChainEditor.tsx` — drawer open/close state; an "Edit agent" affordance on agent/decider nodes.
- `app/workspace/page.tsx` — extract the existing `/api/workspace` fetch into a `refetchAgents()` and pass it down; the drawer calls it on a `saved` status transition so the node's sockets/validation refresh live (today `editorAgents` is fetched once).

**Tests.** UI-light; no pure-logic unit beyond confirming the drawer targets the selected slug.

---

### §2.9 — Author a chain from a template

**Goal.** Turn a `TemplateDef` into a new, editable chain opened in graph mode.

**Key decision — what "from template" produces.** **Fork:** deep-copy the graph of the template's referenced `chain` into a brand-new chain, open it in the graph editor, and prefill the template's `seedPrompt` in the run bar. (A `TemplateDef` today is a saved *(chain-ref, seedPrompt)* preset used only to run as-is; this makes it a starting point you edit.) Alternative — prefill the seed onto an *empty* chain — is much less useful; rejected. If the template's `chain` ref is empty/missing, fall back to the empty starter chain + seed.

**Changes.**
- New `lib/fs/forkChain.ts` — `createChainFromTemplate(template, newName, workspace): { slug }` — resolves the referenced chain, deep-copies `nodes`/`edges` (positions as-is), writes via `serializeChain` + `saveWorkspaceEntity` under a fresh unique slug.
- Extend the existing entity-creation endpoint (the one calling `createWorkspaceEntity`) to accept an optional `fromTemplate` slug.
- Creation UI (sidebar/modal): a "From template" option for new chains; on create, route to `?type=chain&slug=<new>&view=graph&seed=<...>`.
- `app/workspace/page.tsx` — read a `seed` query param → pass as `initialSeedPrompt` to `ChainEditor` (today the seed is internal-only).

**Tests.** `tests/fork-chain.test.ts` — `createChainFromTemplate` copies the referenced graph, mints a unique slug, falls back cleanly on an empty ref.

---

## Group B — Medium

### §1.1 — Inline-chain run (enabler)

**Goal.** Let a run execute a graph passed in the request body, not just one read from disk by name. Removes the flush-before-run coupling and is the foundation for partial runs of un-persisted graphs.

**Approach.** Extend `POST /api/run` to accept an optional inline `chain: { name?, description?, nodes, edges }`. Extract resolution into a pure helper so the route stays thin and testable.

**Changes.**
- New `lib/resolveRunChain.ts` — `resolveRunChain(body, workspace): { chain, title, version }`. Branches: inline `chain` → use directly, `version = 0`, no snapshot; else the existing `chainName`/`agentName` paths (`app/api/run/route.ts:22-48`) moved here verbatim.
- `app/api/run/route.ts` — call the helper; downstream (validate, stream, `meta.graph`) unchanged.
- `components/editor/ChainEditor.tsx` — `run()` posts `{ chain: { name, description, nodes, edges }, seedPrompt }` instead of `flush()` + `chainName`. Autosave still persists via the existing serialize `useEffect`; **runs no longer depend on the write landing**.

**Tests.** `tests/resolve-run-chain.test.ts` — inline graph used as-is with version 0; `chainName` path still resolves from workspace; missing/unknown → error.

---

### §1.2 — Single editor reducer (enabler)

**Goal.** Collapse `ChainEditor`'s scattered `setNodes(prev => …)` callbacks into one pure reducer — the precondition that makes undo/redo almost free.

**Key decision — reducer scope.** Reducer covers **`{ nodes, edges, selectedIds, clipboard }` only.** `runState`/`seedPrompt`/`running` stay as separate `useState` — they are ephemeral execution state and must **not** pollute undo history.

**Approach.** A pure `applyEditorAction(state, action)` that **delegates to the already-tested `editorOps`** — the reducer is orchestration, the ops remain the unit of logic. The serialize→autosave `useEffect` stays as today (`ChainEditor.tsx:52-54`), now keyed on `state.nodes/edges` — centralized in one place (the §1.2 win).

**Changes.**
- New `lib/editorReducer.ts` — `EditorState`, `EditorAction` (`addNode`, `addLoopZone`, `connect`, `deleteNodes`, `deleteEdge`, `moveNodes`, `updateNode`, `setSelection`, `copy`, `paste`, `setGraph`), pure `applyEditorAction`.
- `components/editor/ChainEditor.tsx` — replace the `useState` cluster with `useReducer`; handlers dispatch. `ChainCanvas` props unchanged. Group A's `selectedIds`/`clipboard` fold in here.

**Tests.** `tests/editor-reducer.test.ts` — each action's result; purity (no input mutation).

---

### §2.3 — Undo/redo (depends on §1.2)

**Goal.** Ctrl/Cmd+Z / Shift+Z over editor actions.

**Key decision — history granularity.** Only **committed mutations** create history entries. `setSelection` replaces present **without** pushing; a node move records **one** entry on drag-*stop* (we already persist on `onNodeDragStop`/`onSelectionDragStop`). Each action declares whether it is `historic`. `past` is capped (~50 entries). No mid-drag coalescing in v1.

**Approach.** A `withHistory(reducer)` meta-reducer over `{ past, present, future }`; `UNDO`/`REDO` shuffle the stacks; normal historic actions push present→past and clear future. Undo/redo flow through the same autosave effect, so they persist.

**Changes.**
- New `lib/history.ts` — `withHistory` + `canUndo`/`canRedo` selectors; pure, tested.
- `components/editor/ChainEditor.tsx` — wrap the reducer; undo/redo keybindings (input-guarded, shared with §2.5) + optional toolbar buttons disabled when stacks are empty.

**Tests.** `tests/history.test.ts` — undo/redo; future cleared on a new action; selection-only actions create no entry; cap enforced.

---

### §2.1 — Partial run ("run up to here")

**Goal.** Execute only the upstream subgraph of a target node and show its output.

**Key decision — zone integrity.** Compute the target's **ancestors** (reverse-reachability over edges), then **expand any partially-included loop zone to its full membership** (start + end + body) so the executor's zone invariants hold. No executor change — `runChainGraph` already topo-runs whatever graph it is handed.

**Approach.** Pure truncation + the §1.1 inline run. `startOutputs`-based replay composition is deferred (v1 re-runs the subgraph fresh).

**Changes.**
- New `lib/partialRun.ts` — `upstreamSubgraph(chain, targetId): { nodes, edges }` (reverse BFS over edges + zone-expansion).
- `components/editor/ChainEditor.tsx` — `runUpTo(targetId)` builds the subgraph, posts inline (§1.1), reuses the existing streaming/`runState` handling.

**Tests.** `tests/partial-run.test.ts` — ancestors only; unrelated branches excluded; diamond-dependency dedup; zone fully expanded when any member is included.

---

### §2.2 — Per-node preview (depends on §2.1)

**Goal.** A per-node "preview from here" affordance — the big payoff toward "preview the output of any node."

**Approach.** A small **"▶ from here"** button on each node calls `runUpTo(id)`; on trigger, **auto-select the target** so the existing `NodePreview` pane (`ChainEditor.tsx:186-188`) shows `runState[targetId]` immediately. Nodes outside the subgraph get no `runState` entry, so the partial-vs-full distinction falls out of the existing styling.

**Changes.**
- `components/editor/nodeData.ts` — add `onRunFromHere?(id)` to `EditorNodeData`; node chrome renders the button.
- `components/editor/ChainEditor.tsx` — wire `onRunFromHere = runUpTo`; auto-select the target.

**Tests.** UI-light; logic covered by §2.1.

---

### §2.6 — Drag-into-zone membership

**Goal.** Set a node's `zone` by dragging it into a zone frame.

**Key decisions.**
1. Hit-test the dropped node's **center** against `computeZoneFrames` boxes; inside → set `zone`; dropped outside all frames → clear `zone`.
2. **Do not auto-delete** now-crossing edges — let the existing boundary validation (`chainGraph.ts:132-140`) flag them (non-destructive, consistent with the rest of the editor).
3. **Loop-start/loop-end keep their `zone`** when dragged (they *define* the zone); only ordinary nodes get reassigned.

**Changes.**
- `lib/zoneFrames.ts` — pure `zoneAtPoint(frames, x, y): string | undefined`.
- Move/drag-stop handler — alongside the `pos` update, dispatch `updateNode(id, { zone })` (skip boundary nodes).

**Tests.** `tests/zone-frames.test.ts` additions — point inside/outside a frame; node moved out clears zone; boundary node membership preserved.

---

## Group C — Hard

### §2.4 — Subgraph / nested-chain nodes

**Goal.** A node that references another chain, for reuse and taming large graphs. Needs recursion in validate + executor and cross-chain cycle detection.

**v1 scope split (explicit).** Single seed → one `input` socket; terminal output-producing nodes exposed as outputs; **collapsed execution** (run the referenced chain, surface its terminal output on the node); cross-chain **cycle detection required**. **Inline visual expansion of the inner graph is deferred to v2** — v1 ships a collapsed card with an "Open chain →" link. This split is what keeps §2.4 finishable.

**Data model** (`lib/types.ts`). Add `'subchain'` to `ChainNodeKind`; add `subchain?: string` (referenced chain slug) to `ChainNode`.

**Sockets** (`lib/nodeSockets.ts`). A subchain node's inputs = referenced chain's seed (one `input` in v1); outputs = referenced chain's terminal output-producers (named by inner node id; usually one). The socket fns gain a **`chains: ChainDef[]`** argument (threads through `buildData` and `validateChain`) to resolve the ref.

**Validation** (`lib/chainGraph.ts`). `validateChain` gains a `chains` arg; new `validateSubchains` errors on (a) unknown ref and (b) **cross-chain cycles** — build the transitive subchain-reference graph and detect cycles, including self-reference. Deep recursive validation of the referenced chain is deferred (it validates on its own tab).

**Executor** (`lib/executor.ts`). Gains a `chains` registry; on a `subchain` node, map the live `input` value → the referenced chain's seed, call `runChainGraph` **recursively**, map terminal output → the node's output socket into `nodeOutputs`. Inner node ids are **namespaced** (`<subchainId>/<innerId>`) to avoid collisions; a **max-depth guard** backs up cycle detection.

**Round-trip / wiring.** `lib/serializeChain.ts` + `lib/parseChain.ts` handle the `subchain` kind; new `components/editor/nodes/SubchainNode.tsx` + `nodeTypes` registration + palette entry (the ref picker excludes self and cycle-forming chains); `components/editor/ChainEditor.tsx` and `app/api/run/route.ts` pass `chains` (the route already has them from `loadWorkspace`; the editor fetches them like it does agents/context).

**Tests.**
- `tests/validate-subchain.test.ts` — unknown ref errors; self-reference cycle; A↔B cycle; valid ref passes.
- `tests/executor-subchain.test.ts` — recursive run maps input→seed and terminal→output; depth guard fires; uses a mock `runFn`.
- Socket-derivation test (subchain inputs/outputs from a referenced chain).

---

### §2.8 — External-edit file-watch sync

**Goal.** Reflect on-disk edits (another agent, another tab, hand-edits) into the open graph live, with a real conflict story.

**v1 scope split.** Watch + **two clean reconciliation paths** — *silent adopt* when the canvas has not diverged from last-saved; *non-destructive conflict banner* (Reload from disk / Keep mine) when it has. **Echo suppression is mandatory.** Inline **diff view is deferred to v2**.

**The three-way decision, made pure & testable.** Extract `reconcileExternalEdit({ local, lastSaved, incoming }): 'ignore-echo' | 'adopt' | 'conflict'` into new `lib/syncReconcile.ts`:
- `incoming === lastSaved` → **ignore-echo** (our own autosave write coming back — without this you get a write loop).
- `incoming !== lastSaved` **and** `local === lastSaved` (no unsaved edits) → **adopt**: reparse → `dispatch(setGraph(...))`.
- `incoming !== lastSaved` **and** `local !== lastSaved` → **conflict**: show banner; *Reload* → `setGraph(parsed)`, *Keep mine* → let the next autosave win.

**Plumbing (kept thin).**
- New `app/api/watch/route.ts` (Node runtime) — chokidar watches the resolved entity path with `awaitWriteFinish`; SSE `change` events carry raw content; cleanup on disconnect. **Confirm chokidar is importable as a direct dependency; add it if it is only present transitively via Next.**
- New `hooks/useFileWatch.ts` — subscribe to the SSE stream; expose the incoming raw content.
- `hooks/useAutoSave.ts` — expose `lastSavedContent` (for echo-suppression + divergence detection).
- `components/editor/ChainEditor.tsx` — feed `local`/`lastSaved`/`incoming` into `reconcileExternalEdit`; adopt silently or render the conflict banner. Scoped to the chain graph editor for v1.

**Tests.** `tests/sync-reconcile.test.ts` exercises all three branches exhaustively (the real logic). The chokidar/SSE transport is verified manually.

---

## Out of scope / deferred to a later phase

- Inline visual expansion of subchain inner graphs (§2.4 v2).
- Diff view in the external-edit conflict UI (§2.8 v2).
- `startOutputs`-based replay composition for partial runs (§2.1 — v1 re-runs fresh).
- Multi-seed subchain inputs; deep recursive validation of referenced chains (§2.4).
- System/cross-tab clipboard; whole-zone auto-expansion on copy (§2.5).
- Mid-drag undo coalescing (§2.3).

## Pointers

- Backlog source: `docs/maestro/plans/2026-06-29-alternatives-and-phase5-backlog.md`
- Phase 4 design / plan: `docs/maestro/plans/2026-06-28-visual-chain-editor-design.md`, `…-impl-plan.md`
- Executor / validation / run endpoint: `lib/executor.ts`, `lib/chainGraph.ts`, `app/api/run/route.ts`
- Editor: `components/editor/ChainEditor.tsx`, `ChainCanvas.tsx`, `lib/editorOps.ts`, `lib/zoneFrames.ts`, `lib/serializeChain.ts`
