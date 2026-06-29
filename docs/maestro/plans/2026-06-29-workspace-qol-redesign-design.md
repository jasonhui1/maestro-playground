# Workspace QoL Redesign — Design

> **Status:** Design (spec). Plan: `2026-06-29-workspace-qol-redesign-impl-plan.md`.
> **Source:** Brainstorm 2026-06-29 (visual companion). Supersedes the layout assumptions in `2026-04-09-workspace-ui-qol-design.md`.
> **Depends on:** Phase 5 **Group B** and **Group C** merged first (`2026-06-29-phase5-group-b-impl-plan.md`, `...-group-c-impl-plan.md`). This design assumes the post-B/C codebase — see **Dependencies & rebase** below. Verify against the actual code at implementation time (B/C may have drifted).

## Goal

Maximize canvas space and remove duplicated/awkward chrome on the workspace page, by collapsing the editor's stacked toolbars into **one header line**, consolidating the **two Run buttons into one**, and merging the bottom preview, validation, output console, and history panes into **one dockable, collapsible, tabbed panel** that is the single output surface across every runnable view.

## Problem (today)

On the **Chain · Graph** view, ~4 chrome rows stack above the canvas and two more bars sit below it, and **two Run buttons appear at once** doing different things:

- Page toolbar (`app/workspace/page.tsx`): breadcrumb + title · Parallel · **Run #1** · Output toggle · History toggle.
- Graph/YAML toggle row (`page.tsx`).
- Editor bar (`components/editor/ChainEditor.tsx`): seed prompt · **Run #2** · autosave status.
- Below canvas: `ValidationPanel` bar + fixed-height `NodePreview` (`h-40`).

The two runs are genuinely different code paths: **Run #1** (`handleRun` in `page.tsx`) streams N parallel instances into a right-side Output console (`AgentStreamOutput`); **Run #2** (`ChainEditor.run`) runs once and drives per-node `runState` (graph highlighting + `NodePreview`). Output is also crammed *inside* agent nodes (`AgentNode.tsx:63-67`), stretching them.

## Core concepts / jargon

- **Runnable view** — a view that can execute: Chain·Graph, Chain·YAML, Agent. (Skill/Template/Context are non-runnable.)
- **Dockable panel** — the single merged panel (tabs: Output · Validation · History). Docks bottom (default) or right; collapsible to a strip; resizable.
- **Output (tab)** — shows the **clicked node's** output only (chain views) or the single synthesized node (agent view). Replaces both the old per-node `NodePreview` and the old side console. There is **no full-run transcript** and **no "Preview" tab**.
- **Instance** — one execution in a Parallel batch. The **instance switcher** (`‹ 1/N ›`) selects which instance drives graph highlighting + the Output tab.
- **Run engine** — a single store-owned run loop (replaces both current run paths). Produces **per-instance, per-node** state keyed by `nodeId`.
- **Focus mode** — informal name for "sidebar + palette + panel all collapsed" → maximum canvas.

## Design

### 1. One-line header

Replaces the page toolbar row, the Graph/YAML row, and the editor's seed/run bar with a single line:

```
▌ <Title>  ·  [Graph | YAML]  ·  [ seed prompt — click to expand ]  ·  Parallel [N]  ·  [▶ Run]  ·  <autosave>  ·  [panel ⊟]
```

- The `type / slug` breadcrumb is dropped; the title carries identity.
- **Graph/YAML** toggle appears only for chains.
- **Seed prompt** is a single-line field with a **click-to-expand** popover for long/multi-line prompts (decision a5).
- **autosave** status is a small transient label near Run.
- **panel** control toggles the dockable panel open/collapsed (and its dock side via a small menu).
- Non-runnable views show a minimal header (title only; no seed/Parallel/Run).

### 2. Single Run (unified run engine)

One Run button per view. The two existing run paths collapse into a **store-owned run action** (`useRunStore.run()`) that:

- posts the **inline graph** to `/api/run` (`{ chain: { name, description, nodes, edges }, … }`, per Group B §1.1) — so there is **no flush-before-run and no disk race**. The store reads the live graph from a getter that `ChainEditor` registers (this replaces the `registerFlush` seam discussed during planning);
- honors **Parallel [N]** — runs N instances;
- produces **per-instance, per-node** `runState` keyed by `nodeId`;
- powers graph status dots, node status, and the Output tab from one source.

Because the loop lives in the store (not a component effect), in-app navigation never interrupts it (a4).

**Relationship to Group B:** the store-owned run **supersedes** B's local `runState`/`seedPrompt`/`running` useState (B kept run state in `ChainEditor`; we lift it to the store to satisfy a4). B's partial run (`runUpTo` / "▶ from here", §2.1–2.2) is **rewired onto the store** and its per-node preview output is shown in the **Output tab**, not the deleted bottom `NodePreview`. B's editor reducer + undo/redo (§1.2, §2.3) stay — they own graph topology + selection + clipboard; selection is bridged into `useSelectionStore` for the Output tab.

### 3. Collapsible Chains sidebar

The layout-level `Sidebar` (`app/workspace/layout.tsx` + `components/workspace/Sidebar.tsx`) collapses to a thin icon rail; clicking the rail reopens. Collapse state persists (see §7).

### 4. Collapsible node palette

`components/editor/NodePalette.tsx` (graph view only) collapses to a thin rail; clicking reopens. Persists.

### 5. Merged dockable panel

One panel replaces `ValidationPanel` + `NodePreview` + the side Output console + `HistoryPane`.

- **Tabs:** **Output** · **Validation** · **History**.
- **Dock:** bottom (default) or right; **flip** at runtime.
- **Collapse:** to a strip (orientation follows dock side); a visible affordance always remains.
- **Resize:** drag the divider (min/max bounded so it can't cover the header).
- **Scrollable** body.
- **Output** = clicked node (Graph) / all nodes stacked (YAML) / the synthesized node (Agent), per the matrix below; honors the instance switcher.
- **Validation** = the chain issues list (relocated `ValidationPanel`); tab shows a count or ✓. **Hidden for agent view** (agents have no graph checks).
- **History** = past runs + version snapshots (relocated `HistoryPane`), keyed by `type:slug`. Adds a **side-by-side version-diff** view (decision a1).

### 6. Instance switcher

`‹ 1/N ›` control. On the **canvas** (graph view) and in the **panel header** (all views). Selecting an instance re-renders graph highlighting, skipped states, and the Output tab for that instance. Hidden when N = 1.

### 7. State architecture (Zustand)

Zustand is already a dependency (v5.0.12) and used by `useToastStore`; this follows the same pattern.

- **`useRunStore`** — run lifecycle + results, keyed by `type:slug`: per-instance/per-node `runState`, current instance index, running flag, run-level error, seed + Parallel inputs, and the `run()` action that owns the fetch+stream loop. Single source for graph dots, node status, and the Output tab. Keyed-by-file so each entity keeps its own run/output across tab switches.
- **`useWorkspaceUiStore`** (with `persist` middleware → localStorage) — panel dock side / collapsed / size / active tab; sidebar collapsed; palette collapsed. This is the **persistence** for decision a2/D2 (global).

**Out of the stores:** graph topology (`nodes`/`edges`) and its autosave pipeline stay in `ChainEditor`. Node selection is exposed minimally so the panel's Output tab can read the primary selected node (placement is a plan-time detail).

### 8. Nodes

Only `AgentNode.tsx` changes: remove the inline output block (`AgentNode.tsx:63-67`). The status dot and all else stay. (Verified: it is the only node that renders run output, and it covers both `agent` and `decider` kinds.)

## Per-view behavior

| View | Header | Output tab | Validation tab | Instance switcher |
|---|---|---|---|---|
| Chain · Graph | title · Graph/YAML · seed · Parallel · Run | clicked node's output | chain issues | canvas + panel |
| Chain · YAML | title · Graph/YAML · seed · Parallel · Run | all nodes' output, stacked (no canvas to click) | chain issues | panel header |
| Agent | title · seed · Parallel · Run | the agent's output (synthesized one-node chain, `nodeId = agent.slug`) | hidden | panel header |
| Skill / Template / Context | title only | hidden | hidden | n/a |

Verified: a single-agent run synthesizes a one-node chain server-side (`app/api/run/route.ts:35-43`) and emits `agent_start/token/agent_done` with `nodeId: agent.slug`, so the per-node Output model works for agents with no special-casing.

## Edge cases & resolutions

**Decisions taken:**

- **a1 — Non-runnable views:** show the panel with **History only** (Output + Validation hidden), plus a **side-by-side version-diff** button.
- **a2/D2 — Panel layout memory:** persist dock/collapse/size/active-tab **globally** via `useWorkspaceUiStore` + `persist`.
- **a3 — Run-level failures:** a whole-run error (API failure or `/api/run` rejecting an invalid chain before any node starts) surfaces as a **banner in the panel** and **auto-switches to the Validation tab**.
- **a4 — Run not disrupted:** the run is **store-owned** and keyed by `type:slug`. Tab switch, dock flip, collapse, and canvas unmount do **not** interrupt it. **Boundary:** a hard browser reload (F5) ends the live stream — the run still completes server-side and appears in History (`/api/runs`); live token reconnect after reload is **out of scope**.
- **a5 — Long seed prompt:** single-line field with **click-to-expand** popover.

**Handled with defaults:**

- **Parallel divergence:** the switcher re-renders graph highlighting and skipped states per instance; a node skipped in the selected instance shows "skipped — no output," not stale text.
- **No canvas to click (Agent/YAML):** Agent → the one node; YAML → all nodes stacked in run order. Both use the panel-header switcher.
- **New run resets state;** the switcher hides when Parallel = 1.
- **Streaming:** a selected mid-run node streams tokens live into the Output tab.
- **Collapse affordances:** sidebar/palette/panel always leave a visible rail/strip to reopen.
- **Unparseable chain (YAML view):** the Output tab can still list by `nodeId`/agent name from run events (independent of the editor's parse).

## Dependencies & rebase (Groups B + C)

This design sits on top of Groups B and C. The interactions:

- **B §1.1 inline run** — `/api/run` accepts an inline graph. The run store posts the live graph; **no `registerFlush`**.
- **B §1.2 + §2.3 reducer + undo/redo** — kept. `ChainEditor` owns `{nodes, edges, selectedIds, clipboard}` via `applyEditorAction` + `withHistory`. The run store owns run state only. Selection from the reducer is mirrored to `useSelectionStore` (one write in the existing `setSelection` path) so the Output tab can read it.
- **B §2.1–2.2 partial run / per-node preview** — `runUpTo`/"▶ from here" is rewired to call the store run with an upstream-truncated graph; its output renders in the **Output tab** (the bottom `NodePreview` is gone).
- **C §2.4 subchain** — `SubchainNode` renders no run output, so the AgentNode change doesn't touch it. The **InterfacePanel** (C declares chain ports) is **rehomed**: it moves out of the deleted bottom strip into a header **"Interface ▾" popover** (chains only), consistent with the seed-expand pattern. (Alternative: a 4th "Interface" panel tab — chosen the popover to keep the panel about results/validation/history.)
- **C §2.8 file-watch** — the adopt/conflict banner stays in `ChainEditor`; it must survive the header refactor (render it under the one-line header).

## Out of scope

- Live reconnect to an in-progress run after a hard browser reload (needs server-side run reconnect).
- Moving graph topology (`nodes`/`edges`) into a store.
- Any change to the execution engine / `/api/run` semantics beyond what the unified client run needs.
- Redesign of non-workspace pages (Run, History, Chat top-level routes).

## References / constraints for implementation

- **React Flow v12 (`@xyflow/react`):** read `.agents/skills/xyflow12.md` before touching nodes/canvas (instance switcher overlay, removing the AgentNode output block) — named imports only, `NodeProps<Node<EditorNodeData>>` typing, no direct mutation.
- **Next.js 16 / React 19:** read `.agents/skills/nextjs16.md` before store/client-component work.
- Key files: `app/workspace/page.tsx`, `app/workspace/layout.tsx`, `components/editor/ChainEditor.tsx`, `components/editor/ChainCanvas.tsx`, `components/editor/NodePalette.tsx`, `components/editor/ValidationPanel.tsx`, `components/editor/NodePreview.tsx`, `components/editor/nodes/AgentNode.tsx`, `components/workspace/Sidebar.tsx`, `components/workspace/HistoryPane.tsx`, `lib/runState.ts`, `lib/runStream.ts`, `hooks/store/useToastStore.ts`.
