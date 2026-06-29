# Workspace QoL Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the workspace page's stacked toolbars, duplicate Run buttons, and scattered output panes with a one-line header, a single store-owned run engine, collapsible sidebar/palette, and one dockable tabbed panel (Output · Validation · History) that is the single output surface across all views.

**Architecture:** Two Zustand stores hold the cross-cutting state — `useRunStore` owns the run lifecycle (per-instance, per-node, keyed by `type:slug`) so a run survives any in-app navigation, and `useWorkspaceUiStore` (persisted) holds panel dock/collapse/size/tab + sidebar/palette collapse. The run posts the **inline graph** to `/api/run` (Group B §1.1), so there is no flush-before-run; the store reads the live graph from a getter that `ChainEditor` registers. The graph topology + reducer/history (Group B) and autosave pipeline stay in `ChainEditor`. UI components read run results and node selection from the stores instead of local state and prop-drilling.

**Tech Stack:** Next.js 16.2, React 19, `@xyflow/react` v12, Zustand v5 (already a dep), `diff-match-patch` (already a dep), Tailwind v4, vitest/tsx tests.

**Design source:** `docs/maestro/plans/2026-06-29-workspace-qol-redesign-design.md`.

**Depends on:** Phase 5 **Group B** and **Group C** merged first. This plan assumes the post-B/C codebase (inline run, editor reducer + undo/redo, subchain node, InterfacePanel, file-watch). See **Rebase onto Groups B + C** below. Re-check exact line numbers against the actual code before implementing — B/C edits will have shifted them.

## Global Constraints

- **Zustand v5** — follow the existing `hooks/store/useToastStore.ts` pattern (`import { create } from 'zustand'`). For persistence use `import { persist } from 'zustand/middleware'`.
- **@xyflow/react v12** — read `.agents/skills/xyflow12.md` before Tasks touching `ChainCanvas`/nodes. Named imports only; never mutate node/data objects (always spread); custom node data typed via `NodeProps<Node<EditorNodeData>>`.
- **Next.js 16** — read `.agents/skills/nextjs16.md` before any route/page change. `params`/`searchParams` are async (`await`). No route-handler changes are required by this plan (the versions API already returns content by `?version=N`).
- **Tests** — framework-free `node:assert` scripts in `tests/`. Run a single file with `npx tsx tests/<file>.test.ts`; run the suite with `npm run test:run`. Each logic test file ends with `console.log('✅ <name> passed')`. UI tasks end with **manual verification** (`npm run dev`), then commit.
- **Commits** — one commit per task. Do not commit on `master`; create branch `feat/workspace-qol-redesign` first (Task 0).
- **Run-state keying** — every run event carries `nodeId` (`lib/runStream.ts`); a single-agent run is a synthesized one-node chain with `nodeId = agent.slug` (`app/api/run/route.ts:35-43`). The per-node model needs no per-view special-casing.
- **Baseline = post-B/C** — assume Group B (inline run via `resolveRunChain`; `applyEditorAction` reducer + `withHistory`; `runUpTo`/`upstreamSubgraph`) and Group C (`SubchainNode`, `InterfacePanel`, file-watch) are merged. Do **not** re-add flush-before-run. Line numbers cited below are pre-B/C — re-locate before editing.

---

## Rebase onto Groups B + C

Read this before starting — it overrides anything in the tasks that assumes the current (pre-B/C) code.

1. **Run posts the inline graph, not a flush.** B §1.1 made `/api/run` accept `{ chain: { name, description, nodes, edges }, seedPrompt, type, slug }`. The store-owned `run()` (Task 3) posts that. The store gets the live graph from a **graph provider** that `ChainEditor` registers — `setGraphProvider(key, () => ({ name, description, nodes, edges }))`. This **replaces `registerFlush`** everywhere it appears (Tasks 3, 14, 16). For `type === 'agent'` there is no provider → post `{ agentName: slug }` (B's `resolveRunChain` synthesizes the one-node chain). For chain **YAML** view (no live graph object) → post `{ chainName: slug }`.
2. **The store supersedes B's local run state.** Delete the `runState`/`seedPrompt`/`running`/`runError` useState that B keeps in `ChainEditor`; everything reads `useRunStore`. **Rewire B's `runUpTo`/"▶ from here"** to call `useRunStore.run()` with the upstream-truncated graph (use B's `upstreamSubgraph`), and point its per-node output at the **Output tab** (Task 9), not the deleted `NodePreview`.
3. **Selection bridge.** B's reducer owns `selectedIds`. In the existing `setSelection` dispatch path, also call `useSelectionStore.getState().setSelectedNodeId(ids[0] ?? null)` so the Output tab (Task 9) tracks the clicked node. Task 4's store stays; Task 14's "report selection" step folds into this bridge.
4. **InterfacePanel rehome (C §2.4).** C placed it "between ValidationPanel and NodePreview" — both deleted here. Move it into a header **"Interface ▾" popover** (chains only), same pattern as the seed popover (Task 16). Keep its props/state as C defined them.
5. **File-watch banner (C §2.8).** Keep the adopt/conflict banner in `ChainEditor`; render it directly under the one-line header so the header refactor (Task 16) doesn't drop it.
6. **SubchainNode** renders no run output, so Task 5 (AgentNode output removal) does not touch it.

---

## File Structure

**Phase A — state foundation + run engine**
- Modify `lib/runState.ts` — add `RunInstanceState`, `RunRecord`, `emptyInstance()`, `applyEventToInstance()`, `nodeRunOf()`.
- Modify `tests/run-state.test.ts` — cover the new helpers.
- Create `hooks/store/useRunStore.ts` — run lifecycle keyed by `type:slug` + `run()` action.
- Create `tests/run-store.test.ts` — pure reducers (setSeed/setParallel/setInstanceIndex + a fake-event reduction).
- Create `hooks/store/useWorkspaceUiStore.ts` — persisted UI prefs.
- Create `tests/workspace-ui-store.test.ts` — toggles/setters.
- Create `hooks/store/useSelectionStore.ts` — current selected nodeId (not persisted).
- Modify `components/editor/nodes/AgentNode.tsx` — remove inline output block.

**Phase B — dockable panel**
- Create `components/workspace/panel/DockablePanel.tsx` — shell: tabs, dock, collapse, resize (from `useWorkspaceUiStore`).
- Create `components/workspace/panel/InstanceSwitcher.tsx` — `‹ i/N ›`.
- Create `components/workspace/panel/OutputTab.tsx` — selected-node output from `useRunStore` (relocated `NodePreview`).
- Create `components/workspace/panel/ValidationTab.tsx` — relocated `ValidationPanel`.
- Create `components/workspace/panel/HistoryTab.tsx` — relocated `HistoryPane` body + version diff.
- Create `lib/versionDiff.ts` + `tests/version-diff.test.ts` — line diff via `diff-match-patch`.

**Phase C — header, collapse, per-view wiring**
- Modify `app/workspace/layout.tsx` + `components/workspace/Sidebar.tsx` — collapsible sidebar.
- Modify `components/editor/NodePalette.tsx` — collapsible palette.
- Modify `components/editor/ChainCanvas.tsx` — instance switcher overlay; highlighting from store.
- Modify `components/editor/ChainEditor.tsx` — drop its run bar; read run store; render canvas + palette only.
- Modify `app/workspace/page.tsx` — one-line header, single Run, mount `DockablePanel`, per-view wiring, delete old console.

---

## Task 0: Branch

- [ ] **Step 1: Create the working branch**

Run:
```bash
git checkout -b feat/workspace-qol-redesign
```
Expected: `Switched to a new branch 'feat/workspace-qol-redesign'`.

- [ ] **Step 2: Commit the design + this plan (already on disk)**

```bash
git add docs/maestro/plans/2026-06-29-workspace-qol-redesign-design.md docs/maestro/plans/2026-06-29-workspace-qol-redesign-impl-plan.md .gitignore
git commit -m "docs: workspace QoL redesign spec + plan"
```

---

## Task 1: Per-instance run-state helpers

**Files:**
- Modify: `lib/runState.ts`
- Test: `tests/run-state.test.ts`

**Interfaces:**
- Consumes: existing `NodeRunState`, `RunStateMap`, `applyRunEvent` (`lib/runState.ts`); `RunEvent` (`lib/runStream.ts`).
- Produces:
  - `interface RunInstanceState { nodes: RunStateMap; status: 'running' | 'complete' | 'error'; error?: string }`
  - `interface RunRecord { instances: RunInstanceState[]; instanceIndex: number; running: boolean; error?: string; startedAt?: string }`
  - `emptyInstance(): RunInstanceState`
  - `applyEventToInstance(inst: RunInstanceState, e: RunEvent): RunInstanceState`
  - `nodeRunOf(rec: RunRecord | undefined, nodeId: string): NodeRunState | undefined` (reads the selected instance)

- [ ] **Step 1: Write the failing test** — append to `tests/run-state.test.ts`:

```ts
import { emptyInstance, applyEventToInstance, nodeRunOf, type RunRecord } from '../lib/runState'

// applyEventToInstance routes node events into nodes map, run events to status
let inst = emptyInstance()
assert.strictEqual(inst.status, 'running')
inst = applyEventToInstance(inst, { type: 'agent_start', nodeId: 'a', agentName: 'A', step: 0 })
assert.strictEqual(inst.nodes['a'].status, 'running')
inst = applyEventToInstance(inst, { type: 'agent_done', nodeId: 'a', agentName: 'A', step: 0, output: { agentName: 'A', output: 'hi' } as any })
assert.strictEqual(inst.nodes['a'].output, 'hi')
inst = applyEventToInstance(inst, { type: 'run_complete', runId: 'r1' })
assert.strictEqual(inst.status, 'complete')

const errInst = applyEventToInstance(emptyInstance(), { type: 'error', error: 'boom' })
assert.strictEqual(errInst.status, 'error')
assert.strictEqual(errInst.error, 'boom')

// nodeRunOf reads the selected instance
const rec: RunRecord = { instances: [inst, emptyInstance()], instanceIndex: 0, running: false }
assert.strictEqual(nodeRunOf(rec, 'a')?.output, 'hi')
assert.strictEqual(nodeRunOf({ ...rec, instanceIndex: 1 }, 'a'), undefined)
assert.strictEqual(nodeRunOf(undefined, 'a'), undefined)

console.log('✅ run-state instance helpers passed')
```

- [ ] **Step 2: Run it to confirm it fails**

Run: `npx tsx tests/run-state.test.ts`
Expected: FAIL — `emptyInstance` / `applyEventToInstance` / `nodeRunOf` are not exported.

- [ ] **Step 3: Implement the helpers** — append to `lib/runState.ts`:

```ts
export interface RunInstanceState {
  nodes: RunStateMap
  status: 'running' | 'complete' | 'error'
  error?: string
}

export interface RunRecord {
  instances: RunInstanceState[]
  instanceIndex: number
  running: boolean
  error?: string
  startedAt?: string
}

export const emptyInstance = (): RunInstanceState => ({ nodes: {}, status: 'running' })

export function applyEventToInstance(inst: RunInstanceState, e: RunEvent): RunInstanceState {
  if (e.type === 'error') return { ...inst, status: 'error', error: e.error }
  if (e.type === 'run_complete') return { ...inst, status: 'complete' }
  return { ...inst, nodes: applyRunEvent(inst.nodes, e) }
}

export function nodeRunOf(rec: RunRecord | undefined, nodeId: string): NodeRunState | undefined {
  const inst = rec?.instances[rec.instanceIndex]
  return inst?.nodes[nodeId]
}
```

- [ ] **Step 4: Run the test to confirm it passes**

Run: `npx tsx tests/run-state.test.ts`
Expected: PASS — prints `✅ run-state instance helpers passed`.

- [ ] **Step 5: Commit**

```bash
git add lib/runState.ts tests/run-state.test.ts
git commit -m "feat: per-instance run-state helpers"
```

---

## Task 2: `useWorkspaceUiStore` (persisted UI prefs)

**Files:**
- Create: `hooks/store/useWorkspaceUiStore.ts`
- Test: `tests/workspace-ui-store.test.ts`

**Interfaces:**
- Produces:
  - `type DockSide = 'bottom' | 'right'`
  - `type PanelTab = 'output' | 'validation' | 'history'`
  - store fields: `sidebarCollapsed`, `paletteCollapsed`, `panelCollapsed`, `panelDock: DockSide`, `panelSize: number`, `panelTab: PanelTab`
  - actions: `toggleSidebar()`, `togglePalette()`, `togglePanel()`, `setPanelDock(d)`, `setPanelSize(n)`, `setPanelTab(t)`, `openPanelTab(t)` (sets tab **and** clears `panelCollapsed` — used by the a3 auto-switch).

- [ ] **Step 1: Write the failing test** — `tests/workspace-ui-store.test.ts`:

```ts
import assert from 'node:assert'
import { useWorkspaceUiStore } from '../hooks/store/useWorkspaceUiStore'

const s = useWorkspaceUiStore.getState()
assert.strictEqual(s.panelDock, 'bottom')
assert.strictEqual(s.panelCollapsed, false)

s.togglePanel()
assert.strictEqual(useWorkspaceUiStore.getState().panelCollapsed, true)

s.openPanelTab('validation')
assert.strictEqual(useWorkspaceUiStore.getState().panelTab, 'validation')
assert.strictEqual(useWorkspaceUiStore.getState().panelCollapsed, false) // openPanelTab un-collapses

s.setPanelDock('right')
assert.strictEqual(useWorkspaceUiStore.getState().panelDock, 'right')

s.toggleSidebar()
assert.strictEqual(useWorkspaceUiStore.getState().sidebarCollapsed, true)

console.log('✅ workspace-ui store passed')
```

- [ ] **Step 2: Run to confirm it fails**

Run: `npx tsx tests/workspace-ui-store.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement** — `hooks/store/useWorkspaceUiStore.ts`:

```ts
import { create } from 'zustand'
import { persist } from 'zustand/middleware'

export type DockSide = 'bottom' | 'right'
export type PanelTab = 'output' | 'validation' | 'history'

interface WorkspaceUiState {
  sidebarCollapsed: boolean
  paletteCollapsed: boolean
  panelCollapsed: boolean
  panelDock: DockSide
  panelSize: number
  panelTab: PanelTab
  toggleSidebar: () => void
  togglePalette: () => void
  togglePanel: () => void
  setPanelDock: (d: DockSide) => void
  setPanelSize: (n: number) => void
  setPanelTab: (t: PanelTab) => void
  openPanelTab: (t: PanelTab) => void
}

export const useWorkspaceUiStore = create<WorkspaceUiState>()(
  persist(
    (set) => ({
      sidebarCollapsed: false,
      paletteCollapsed: false,
      panelCollapsed: false,
      panelDock: 'bottom',
      panelSize: 240,
      panelTab: 'output',
      toggleSidebar: () => set((s) => ({ sidebarCollapsed: !s.sidebarCollapsed })),
      togglePalette: () => set((s) => ({ paletteCollapsed: !s.paletteCollapsed })),
      togglePanel: () => set((s) => ({ panelCollapsed: !s.panelCollapsed })),
      setPanelDock: (panelDock) => set({ panelDock }),
      setPanelSize: (panelSize) => set({ panelSize }),
      setPanelTab: (panelTab) => set({ panelTab }),
      openPanelTab: (panelTab) => set({ panelTab, panelCollapsed: false }),
    }),
    { name: 'maestro-workspace-ui' },
  ),
)
```

- [ ] **Step 4: Run to confirm it passes**

Run: `npx tsx tests/workspace-ui-store.test.ts`
Expected: PASS — prints `✅ workspace-ui store passed`. (Persist falls back to in-memory when `localStorage` is absent under tsx; that's fine.)

- [ ] **Step 5: Commit**

```bash
git add hooks/store/useWorkspaceUiStore.ts tests/workspace-ui-store.test.ts
git commit -m "feat: persisted workspace UI store"
```

---

## Task 3: `useRunStore` (store-owned run engine)

**Files:**
- Create: `hooks/store/useRunStore.ts`
- Test: `tests/run-store.test.ts`

**Interfaces:**
- Consumes: `RunRecord`, `RunInstanceState`, `emptyInstance`, `applyEventToInstance` (`lib/runState.ts`); `streamRun` (`lib/runStream.ts`).
- Produces:
  - `runKey(type: string, slug: string): string` → `` `${type}:${slug}` ``
  - store fields: `runsByKey: Record<string, RunRecord>`, `inputsByKey: Record<string, { seedPrompt: string; parallelCount: number }>`, `graphProviders: Record<string, GraphProvider>`
  - `type GraphProvider = () => { name: string; description?: string; nodes: ChainNode[]; edges: ChainEdge[] }`
  - actions: `setSeed(key, seed)`, `setParallel(key, n)`, `setInstanceIndex(key, i)`, `setGraphProvider(key, fn)`, `run(args: { key: string; type: string; slug: string; graph?: { name: string; description?: string; nodes: ChainNode[]; edges: ChainEdge[] } }): Promise<void>`
  - selector helper (plain export): `inputsOf(state, key)` returns `{ seedPrompt: '', parallelCount: 1 }` default.
  - **Inline-run body (post-B):** `run()` builds the POST body by precedence — `args.graph` (explicit, e.g. partial run) → the registered `graphProviders[key]()` → `{ agentName: slug }` (agent view) → `{ chainName: slug }` (YAML view). When a graph is used, post `{ chain, seedPrompt, type, slug }`; this is B §1.1. No flush.

- [ ] **Step 1: Write the failing test** — `tests/run-store.test.ts` (covers pure reducers, not network):

```ts
import assert from 'node:assert'
import { useRunStore, runKey } from '../hooks/store/useRunStore'

assert.strictEqual(runKey('chain', 'triage-demo'), 'chain:triage-demo')

const k = runKey('chain', 't')
useRunStore.getState().setSeed(k, 'hello')
useRunStore.getState().setParallel(k, 3)
assert.strictEqual(useRunStore.getState().inputsByKey[k].seedPrompt, 'hello')
assert.strictEqual(useRunStore.getState().inputsByKey[k].parallelCount, 3)

// instanceIndex setter is clamp-free but no-throw on missing record
useRunStore.getState().setInstanceIndex(k, 2)
// no record yet -> creates/updates index defensively without throwing
assert.doesNotThrow(() => useRunStore.getState().setInstanceIndex(k, 1))

console.log('✅ run-store reducers passed')
```

- [ ] **Step 2: Run to confirm it fails**

Run: `npx tsx tests/run-store.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement** — `hooks/store/useRunStore.ts`:

```ts
import { create } from 'zustand'
import { streamRun } from '@/lib/runStream'
import { emptyInstance, applyEventToInstance, type RunRecord } from '@/lib/runState'
import type { ChainNode, ChainEdge } from '@/lib/types'

export const runKey = (type: string, slug: string) => `${type}:${slug}`

export type GraphProvider = () => { name: string; description?: string; nodes: ChainNode[]; edges: ChainEdge[] }
type Graph = ReturnType<GraphProvider>

interface RunInputs { seedPrompt: string; parallelCount: number }
const DEFAULT_INPUTS: RunInputs = { seedPrompt: '', parallelCount: 1 }

interface RunStore {
  runsByKey: Record<string, RunRecord>
  inputsByKey: Record<string, RunInputs>
  graphProviders: Record<string, GraphProvider>
  setSeed: (key: string, seedPrompt: string) => void
  setParallel: (key: string, parallelCount: number) => void
  setInstanceIndex: (key: string, instanceIndex: number) => void
  setGraphProvider: (key: string, fn: GraphProvider) => void
  run: (args: { key: string; type: string; slug: string; graph?: Graph }) => Promise<void>
}

export function inputsOf(state: RunStore, key: string): RunInputs {
  return state.inputsByKey[key] ?? DEFAULT_INPUTS
}

export const useRunStore = create<RunStore>((set, get) => ({
  runsByKey: {},
  inputsByKey: {},
  graphProviders: {},

  setSeed: (key, seedPrompt) =>
    set((s) => ({ inputsByKey: { ...s.inputsByKey, [key]: { ...inputsOf(s, key), seedPrompt } } })),

  setParallel: (key, parallelCount) =>
    set((s) => ({ inputsByKey: { ...s.inputsByKey, [key]: { ...inputsOf(s, key), parallelCount: Math.max(1, parallelCount) } } })),

  setInstanceIndex: (key, instanceIndex) =>
    set((s) => {
      const rec = s.runsByKey[key]
      if (!rec) return s
      return { runsByKey: { ...s.runsByKey, [key]: { ...rec, instanceIndex } } }
    }),

  setGraphProvider: (key, fn) =>
    set((s) => ({ graphProviders: { ...s.graphProviders, [key]: fn } })),

  run: async ({ key, type, slug, graph }) => {
    const { parallelCount, seedPrompt } = inputsOf(get(), key)
    const n = Math.max(1, parallelCount)

    // Inline-run body (Group B §1.1): explicit graph → registered provider → agent → chain-by-name.
    const live = graph ?? get().graphProviders[key]?.()
    const body = live
      ? { chain: live, seedPrompt, type, slug }
      : type === 'agent'
        ? { agentName: slug, seedPrompt, type, slug }
        : { chainName: slug, seedPrompt, type, slug }

    set((s) => ({
      runsByKey: {
        ...s.runsByKey,
        [key]: {
          instances: Array.from({ length: n }, () => emptyInstance()),
          instanceIndex: 0,
          running: true,
          error: undefined,
          startedAt: new Date().toISOString(),
        },
      },
    }))

    // mutate one instance immutably inside the record
    const apply = (i: number, ev: Parameters<typeof applyEventToInstance>[1]) =>
      set((s) => {
        const rec = s.runsByKey[key]
        if (!rec) return s
        const instances = rec.instances.map((inst, idx) => (idx === i ? applyEventToInstance(inst, ev) : inst))
        return { runsByKey: { ...s.runsByKey, [key]: { ...rec, instances } } }
      })

    const setRunError = (msg: string) =>
      set((s) => {
        const rec = s.runsByKey[key]
        if (!rec) return s
        return { runsByKey: { ...s.runsByKey, [key]: { ...rec, error: msg } } }
      })

    const runOne = async (i: number) => {
      try {
        const res = await fetch('/api/run', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        })
        if (!res.ok) {
          const body = await res.json().catch(() => ({}))
          const msg = (body.errors as string[] | undefined)?.join('; ') ?? body.error ?? `Run failed (${res.status})`
          setRunError(msg)
          apply(i, { type: 'error', error: msg })
          return
        }
        const reader = res.body?.getReader()
        if (!reader) return
        await streamRun(reader, (ev) => apply(i, ev))
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        setRunError(msg)
        apply(i, { type: 'error', error: msg })
      }
    }

    try {
      await Promise.all(Array.from({ length: n }, (_, i) => runOne(i)))
    } finally {
      set((s) => {
        const rec = s.runsByKey[key]
        if (!rec) return s
        return { runsByKey: { ...s.runsByKey, [key]: { ...rec, running: false } } }
      })
    }
  },
}))
```

- [ ] **Step 4: Run to confirm it passes**

Run: `npx tsx tests/run-store.test.ts`
Expected: PASS — prints `✅ run-store reducers passed`.

- [ ] **Step 5: Commit**

```bash
git add hooks/store/useRunStore.ts tests/run-store.test.ts
git commit -m "feat: store-owned run engine (per-instance, keyed by file)"
```

---

## Task 4: `useSelectionStore` (current selected node)

**Files:**
- Create: `hooks/store/useSelectionStore.ts`

**Interfaces:**
- Produces: `selectedNodeId: string | null`, `setSelectedNodeId(id: string | null)`.

- [ ] **Step 1: Implement** — `hooks/store/useSelectionStore.ts`:

```ts
import { create } from 'zustand'

interface SelectionStore {
  selectedNodeId: string | null
  setSelectedNodeId: (id: string | null) => void
}

export const useSelectionStore = create<SelectionStore>((set) => ({
  selectedNodeId: null,
  setSelectedNodeId: (selectedNodeId) => set({ selectedNodeId }),
}))
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: no new errors.

- [ ] **Step 3: Commit**

```bash
git add hooks/store/useSelectionStore.ts
git commit -m "feat: selection store for current node"
```

---

## Task 5: Remove inline output from AgentNode

**Files:**
- Modify: `components/editor/nodes/AgentNode.tsx:63-67`

- [ ] **Step 1: Delete the output block** — remove exactly:

```tsx
        {run && run.output && (
          <div className="mt-2 text-[10px] text-zinc-600 bg-zinc-50 border border-zinc-100 rounded p-2 max-h-24 overflow-hidden whitespace-pre-wrap">
            {run.output.slice(0, 240)}
          </div>
        )}
```

The status dot (`statusDotClass(run)`), skipped opacity, and issue border stay — only the text block goes. (`run` is still read for the dot, so no unused-var lint.)

- [ ] **Step 2: Manual verify**

Run: `npm run dev`, open a chain, click Run (old button still works at this point). Expected: nodes show the status dot turning green/blue/red but **do not grow** with output text.

- [ ] **Step 3: Commit**

```bash
git add components/editor/nodes/AgentNode.tsx
git commit -m "feat: stop rendering run output inside agent nodes"
```

---

## Task 6: Version-diff utility

**Files:**
- Create: `lib/versionDiff.ts`
- Test: `tests/version-diff.test.ts`

**Interfaces:**
- Consumes: `diff-match-patch` (dep).
- Produces: `diffLines(a: string, b: string): { type: 'eq' | 'add' | 'del'; text: string }[]`.

- [ ] **Step 1: Write the failing test** — `tests/version-diff.test.ts`:

```ts
import assert from 'node:assert'
import { diffLines } from '../lib/versionDiff'

const out = diffLines('a\nb\nc', 'a\nB\nc')
assert.ok(out.some((d) => d.type === 'del' && d.text.includes('b')))
assert.ok(out.some((d) => d.type === 'add' && d.text.includes('B')))
assert.ok(out.some((d) => d.type === 'eq' && d.text.includes('a')))

console.log('✅ version-diff passed')
```

- [ ] **Step 2: Run to confirm it fails**

Run: `npx tsx tests/version-diff.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement** — `lib/versionDiff.ts`:

```ts
import { diff_match_patch, DIFF_DELETE, DIFF_INSERT } from 'diff-match-patch'

export interface DiffLine { type: 'eq' | 'add' | 'del'; text: string }

// Line-mode diff: tokenize to lines, diff, expand back to lines.
export function diffLines(a: string, b: string): DiffLine[] {
  const dmp = new diff_match_patch()
  const { chars1, chars2, lineArray } = dmp.diff_linesToChars_(a, b)
  const diffs = dmp.diff_main(chars1, chars2, false)
  dmp.diff_charsToLines_(diffs, lineArray)
  const out: DiffLine[] = []
  for (const [op, data] of diffs) {
    const type = op === DIFF_INSERT ? 'add' : op === DIFF_DELETE ? 'del' : 'eq'
    for (const line of data.replace(/\n$/, '').split('\n')) out.push({ type, text: line })
  }
  return out
}
```

- [ ] **Step 4: Run to confirm it passes**

Run: `npx tsx tests/version-diff.test.ts`
Expected: PASS — prints `✅ version-diff passed`.

- [ ] **Step 5: Commit**

```bash
git add lib/versionDiff.ts tests/version-diff.test.ts
git commit -m "feat: line-mode version diff util"
```

---

## Task 7: DockablePanel shell

**Files:**
- Create: `components/workspace/panel/DockablePanel.tsx`

**Interfaces:**
- Consumes: `useWorkspaceUiStore` (dock/collapse/size/tab), `DockSide`, `PanelTab`.
- Produces: `<DockablePanel tabs={{ output, validation, history }} hiddenTabs?={PanelTab[]} switcher?={ReactNode} />` where each tab value is a `ReactNode`. Renders the active, non-hidden tab; honors dock side, collapse, and drag-resize.

- [ ] **Step 1: Implement** — `components/workspace/panel/DockablePanel.tsx`:

```tsx
'use client'
import React, { useCallback, useRef } from 'react'
import { useWorkspaceUiStore, type PanelTab } from '@/hooks/store/useWorkspaceUiStore'
import { ChevronDown, PanelRight, PanelBottom } from 'lucide-react'

const LABELS: Record<PanelTab, string> = { output: 'Output', validation: 'Validation', history: 'History' }

export default function DockablePanel({
  tabs, hiddenTabs = [], switcher,
}: {
  tabs: Partial<Record<PanelTab, React.ReactNode>>
  hiddenTabs?: PanelTab[]
  switcher?: React.ReactNode
}) {
  const { panelDock, panelCollapsed, panelSize, panelTab, setPanelTab, togglePanel, setPanelDock, setPanelSize } =
    useWorkspaceUiStore()
  const dragging = useRef(false)

  const order = (['output', 'validation', 'history'] as PanelTab[]).filter((t) => !hiddenTabs.includes(t) && tabs[t] !== undefined)
  const active = order.includes(panelTab) ? panelTab : order[0]

  const onDrag = useCallback((e: React.MouseEvent) => {
    dragging.current = true
    const startPos = panelDock === 'bottom' ? e.clientY : e.clientX
    const startSize = panelSize
    const move = (m: MouseEvent) => {
      if (!dragging.current) return
      const delta = panelDock === 'bottom' ? startPos - m.clientY : startPos - m.clientX
      setPanelSize(Math.min(700, Math.max(120, startSize + delta)))
    }
    const up = () => { dragging.current = false; window.removeEventListener('mousemove', move); window.removeEventListener('mouseup', up) }
    window.addEventListener('mousemove', move); window.addEventListener('mouseup', up)
  }, [panelDock, panelSize, setPanelSize])

  const isBottom = panelDock === 'bottom'

  if (panelCollapsed) {
    return (
      <button onClick={togglePanel}
        className={`flex items-center justify-center gap-2 text-[10px] font-bold uppercase tracking-widest text-zinc-500 bg-white ${isBottom ? 'border-t h-7 w-full' : 'border-l w-7 h-full [writing-mode:vertical-rl]'} border-zinc-200 hover:bg-zinc-50`}>
        {order.map((t) => LABELS[t]).join(' · ')}
      </button>
    )
  }

  return (
    <div className={`flex bg-white ${isBottom ? 'flex-col border-t' : 'flex-row-reverse border-l'} border-zinc-200`}
      style={isBottom ? { height: panelSize } : { width: panelSize }}>
      <div className={isBottom ? 'h-1 w-full cursor-row-resize hover:bg-zinc-200' : 'w-1 h-full cursor-col-resize hover:bg-zinc-200'} onMouseDown={onDrag} />
      <div className="flex-1 min-h-0 min-w-0 flex flex-col">
        <div className="flex items-center border-b border-zinc-200 bg-zinc-50/40">
          {order.map((t) => (
            <button key={t} onClick={() => setPanelTab(t)}
              className={`px-3 py-1.5 text-[11px] font-bold uppercase tracking-wide ${active === t ? 'text-zinc-900 border-b-2 border-zinc-900 bg-white' : 'text-zinc-400 hover:text-zinc-600'}`}>
              {LABELS[t]}
            </button>
          ))}
          <div className="flex-1" />
          {switcher}
          <button onClick={() => setPanelDock(isBottom ? 'right' : 'bottom')} className="p-1.5 text-zinc-400 hover:text-zinc-700" title="Flip dock">
            {isBottom ? <PanelRight size={14} /> : <PanelBottom size={14} />}
          </button>
          <button onClick={togglePanel} className="p-1.5 text-zinc-400 hover:text-zinc-700" title="Collapse"><ChevronDown size={14} /></button>
        </div>
        <div className="flex-1 min-h-0 overflow-auto">{tabs[active]}</div>
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: no new errors. (Verify `PanelRight`/`PanelBottom`/`ChevronDown` exist in the installed `lucide-react`; if any is missing, substitute `Columns2`/`Rows2`/`ChevronDown`.)

- [ ] **Step 3: Commit**

```bash
git add components/workspace/panel/DockablePanel.tsx
git commit -m "feat: dockable panel shell (tabs, dock, collapse, resize)"
```

---

## Task 8: InstanceSwitcher

**Files:**
- Create: `components/workspace/panel/InstanceSwitcher.tsx`

**Interfaces:**
- Consumes: `useRunStore` (`runsByKey`, `setInstanceIndex`), `runKey`.
- Produces: `<InstanceSwitcher fileKey={string} />` — renders nothing when the record has ≤1 instance; otherwise `‹ i/N ›`.

- [ ] **Step 1: Implement** — `components/workspace/panel/InstanceSwitcher.tsx`:

```tsx
'use client'
import React from 'react'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import { useRunStore } from '@/hooks/store/useRunStore'

export default function InstanceSwitcher({ fileKey }: { fileKey: string }) {
  const rec = useRunStore((s) => s.runsByKey[fileKey])
  const setInstanceIndex = useRunStore((s) => s.setInstanceIndex)
  const n = rec?.instances.length ?? 0
  if (n <= 1) return null
  const i = rec!.instanceIndex
  return (
    <div className="flex items-center gap-1 px-2 text-[11px] text-zinc-600">
      <button onClick={() => setInstanceIndex(fileKey, (i - 1 + n) % n)} className="hover:text-zinc-900"><ChevronLeft size={13} /></button>
      <span className="tabular-nums">{i + 1}/{n}</span>
      <button onClick={() => setInstanceIndex(fileKey, (i + 1) % n)} className="hover:text-zinc-900"><ChevronRight size={13} /></button>
    </div>
  )
}
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: no new errors.

- [ ] **Step 3: Commit**

```bash
git add components/workspace/panel/InstanceSwitcher.tsx
git commit -m "feat: parallel instance switcher"
```

---

## Task 9: OutputTab (selected-node output)

**Files:**
- Create: `components/workspace/panel/OutputTab.tsx`

**Interfaces:**
- Consumes: `useRunStore` (`runsByKey`), `nodeRunOf` (`lib/runState`), `useSelectionStore` (`selectedNodeId`).
- Produces: `<OutputTab fileKey={string} mode={'graph' | 'stack' | 'single'} singleNodeId?={string} />`.
  - `graph` → the selected node (from `useSelectionStore`).
  - `single` → `singleNodeId` (agent view, = agent slug).
  - `stack` → every node in the selected instance, in insertion order (YAML view).

- [ ] **Step 1: Implement** — `components/workspace/panel/OutputTab.tsx`:

```tsx
'use client'
import React from 'react'
import { useRunStore } from '@/hooks/store/useRunStore'
import { useSelectionStore } from '@/hooks/store/useSelectionStore'
import { nodeRunOf } from '@/lib/runState'
import type { NodeRunState } from '@/lib/runState'

function NodeBlock({ nodeId, run }: { nodeId: string; run?: NodeRunState }) {
  if (!run) return <div className="px-4 py-3 text-[11px] text-zinc-400 italic">No output for “{nodeId}” in this instance.</div>
  return (
    <div className="px-4 py-3">
      <div className="text-[10px] font-bold text-zinc-400 uppercase tracking-widest mb-1">{nodeId} · {run.status}</div>
      {run.rounds.length > 1
        ? run.rounds.map((r) => (
            <div key={r.round} className="mb-2">
              <div className="text-[9px] font-bold text-zinc-400">round {r.round}</div>
              <pre className="text-[11px] whitespace-pre-wrap text-zinc-700">{r.output}</pre>
            </div>
          ))
        : <pre className="text-[11px] whitespace-pre-wrap text-zinc-700">{run.output}</pre>}
      {run.thought && <pre className="mt-2 text-[10px] whitespace-pre-wrap text-zinc-400 border-t border-zinc-100 pt-2">{run.thought}</pre>}
    </div>
  )
}

export default function OutputTab({ fileKey, mode, singleNodeId }: {
  fileKey: string; mode: 'graph' | 'stack' | 'single'; singleNodeId?: string
}) {
  const rec = useRunStore((s) => s.runsByKey[fileKey])
  const selectedNodeId = useSelectionStore((s) => s.selectedNodeId)

  if (rec?.error) {
    return <div className="px-4 py-3 text-[11px] text-red-600 bg-red-50 border-b border-red-100">Run error: {rec.error}</div>
  }
  if (mode === 'stack') {
    const inst = rec?.instances[rec.instanceIndex]
    const ids = inst ? Object.keys(inst.nodes) : []
    if (!ids.length) return <div className="px-4 py-3 text-[11px] text-zinc-400 italic">No run output yet.</div>
    return <>{ids.map((id) => <NodeBlock key={id} nodeId={id} run={inst!.nodes[id]} />)}</>
  }
  const nodeId = mode === 'single' ? (singleNodeId ?? '') : selectedNodeId
  if (!nodeId) return <div className="px-4 py-3 text-[11px] text-zinc-400 italic">Select a node to see its output.</div>
  return <NodeBlock nodeId={nodeId} run={nodeRunOf(rec, nodeId)} />
}
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: no new errors.

- [ ] **Step 3: Commit**

```bash
git add components/workspace/panel/OutputTab.tsx
git commit -m "feat: Output tab (selected-node / stacked / single)"
```

---

## Task 10: ValidationTab

**Files:**
- Create: `components/workspace/panel/ValidationTab.tsx`

**Interfaces:**
- Consumes: `ValidationIssue` (`lib/types`), `useSelectionStore` (`setSelectedNodeId`).
- Produces: `<ValidationTab issues={ValidationIssue[]} />` (selecting an issue sets the selected node so the canvas/Output can react).

- [ ] **Step 1: Implement** — `components/workspace/panel/ValidationTab.tsx` (relocated from `components/editor/ValidationPanel.tsx`, now writing selection to the store):

```tsx
'use client'
import React from 'react'
import type { ValidationIssue } from '@/lib/types'
import { useSelectionStore } from '@/hooks/store/useSelectionStore'

export default function ValidationTab({ issues }: { issues: ValidationIssue[] }) {
  const setSelectedNodeId = useSelectionStore((s) => s.setSelectedNodeId)
  if (issues.length === 0) return <div className="px-4 py-3 text-[11px] text-green-600">✓ No validation issues</div>
  return (
    <div className="bg-red-50/40">
      <div className="px-4 py-1.5 text-[10px] font-bold text-red-600 uppercase tracking-widest">{issues.length} issue(s)</div>
      <ul className="px-2 pb-2 space-y-0.5">
        {issues.map((i, idx) => (
          <li key={idx}>
            <button onClick={() => setSelectedNodeId(i.nodeId ?? i.edge?.toNode ?? null)}
              className="w-full text-left text-[11px] text-red-700 hover:bg-red-100/60 rounded px-2 py-0.5">
              {i.message}
            </button>
          </li>
        ))}
      </ul>
    </div>
  )
}
```

- [ ] **Step 2: Typecheck → Commit**

Run: `npx tsc --noEmit` (no new errors).
```bash
git add components/workspace/panel/ValidationTab.tsx
git commit -m "feat: Validation tab"
```

---

## Task 11: HistoryTab (relocated history + version diff)

**Files:**
- Create: `components/workspace/panel/HistoryTab.tsx`

**Interfaces:**
- Consumes: existing endpoints `/api/runs?entityType&slug` and `/api/workspace/${type}/${slug}/versions` (+ `?version=N` for content); `AgentStreamOutput`; `diffLines` (`lib/versionDiff`).
- Produces: `<HistoryTab entityType={string} slug={string} />`.

- [ ] **Step 1: Implement** — start from the body of `components/workspace/HistoryPane.tsx` (Runs + Versions tabs), drop its outer `border-l`/header chrome (the DockablePanel provides chrome), and **add a version-diff affordance**: each version row gets a "Compare to current" button that fetches `?version=N` and the live content, renders `diffLines(versionContent, currentContent)` side-by-side. Keep the existing restore button and run list.

Key diff render block to add (inside the Versions list, shown when a version is selected for compare):

```tsx
// state: const [compare, setCompare] = useState<{ version: number; lines: DiffLine[] } | null>(null)
// onClick handler:
async function compareVersion(version: number) {
  const [vRes, curRes] = await Promise.all([
    fetch(`/api/workspace/${entityType}/${slug}/versions?version=${version}`),
    fetch(`/api/workspace/${entityType}/${slug}`),
  ])
  const vBody = await vRes.json()
  const curBody = await curRes.json()
  setCompare({ version, lines: diffLines(vBody.content ?? '', curBody.raw ?? '') })
}

// render:
{compare && (
  <div className="grid grid-cols-1 gap-0.5 font-mono text-[11px] border border-zinc-200 rounded p-2">
    {compare.lines.map((l, i) => (
      <div key={i} className={l.type === 'add' ? 'bg-green-50 text-green-800' : l.type === 'del' ? 'bg-red-50 text-red-800' : 'text-zinc-600'}>
        <span className="select-none opacity-50 mr-2">{l.type === 'add' ? '+' : l.type === 'del' ? '-' : ' '}</span>{l.text || ' '}
      </div>
    ))}
  </div>
)}
```

(Confirm the content field names against the API: versions returns `{ content }`, the file route returns `{ raw }` — see `components/workspace/HistoryPane.tsx:84-85` and `app/workspace/page.tsx:123`.)

- [ ] **Step 2: Manual verify**

Run app, open the History tab, expand a run (outputs render), click Compare on a version → see a red/green line diff vs current.

- [ ] **Step 3: Commit**

```bash
git add components/workspace/panel/HistoryTab.tsx
git commit -m "feat: History tab with version diff"
```

---

## Task 12: Collapsible Chains sidebar

**Files:**
- Modify: `app/workspace/layout.tsx`
- Modify: `components/workspace/Sidebar.tsx`

- [ ] **Step 1: Add a collapse toggle + collapsed rail** — in `app/workspace/layout.tsx`, read `sidebarCollapsed` from `useWorkspaceUiStore`. When collapsed, render a 40px rail (a button with a `PanelLeftOpen` icon calling `toggleSidebar`) instead of the `<Panel>` with `Sidebar`. When expanded, render the resizable `Panel` as today plus a collapse button (`PanelLeftClose`) in `Sidebar`'s header that calls `toggleSidebar`.

Replace the sidebar `<Panel>`/`<Separator>` block:

```tsx
'use client'
import Sidebar from '@/components/workspace/Sidebar'
import { Suspense } from 'react'
import { Group, Panel, Separator } from 'react-resizable-panels'
import { useWorkspaceUiStore } from '@/hooks/store/useWorkspaceUiStore'
import { PanelLeftOpen } from 'lucide-react'

export default function WorkspaceLayout({ children }: { children: React.ReactNode }) {
  const { sidebarCollapsed, toggleSidebar } = useWorkspaceUiStore()
  return (
    <div className="h-[calc(100vh-3.5rem)] overflow-hidden">
      <Group orientation="horizontal">
        {sidebarCollapsed ? (
          <div className="w-10 shrink-0 border-r border-zinc-200 bg-white flex flex-col items-center py-3">
            <button onClick={toggleSidebar} className="p-2 text-zinc-400 hover:text-zinc-700" title="Expand sidebar"><PanelLeftOpen size={18} /></button>
          </div>
        ) : (
          <>
            <Panel defaultSize="20%" minSize="15%" maxSize="40%">
              <Suspense fallback={<div className="h-full border-r border-zinc-200 bg-white p-4">Loading sidebar...</div>}>
                <Sidebar />
              </Suspense>
            </Panel>
            <Separator className="w-1 bg-zinc-100 hover:bg-zinc-200 transition-colors border-x border-zinc-200" />
          </>
        )}
        <Panel>
          <main className="h-full overflow-auto bg-white">{children}</main>
        </Panel>
      </Group>
    </div>
  )
}
```

In `components/workspace/Sidebar.tsx`, add a collapse button at the top of the `w-[64px]` category rail (top of the `<div className="w-[64px] ...">`), before the category buttons:

```tsx
import { PanelLeftClose } from 'lucide-react'
import { useWorkspaceUiStore } from '@/hooks/store/useWorkspaceUiStore'
// inside component:
const toggleSidebar = useWorkspaceUiStore((s) => s.toggleSidebar)
// first child of the 64px rail:
<button onClick={toggleSidebar} className="p-2.5 rounded-lg text-zinc-400 hover:text-zinc-600 hover:bg-zinc-50" title="Collapse sidebar"><PanelLeftClose size={20} /></button>
```

- [ ] **Step 2: Manual verify**

Collapse → sidebar becomes a thin rail; the expand button restores it; reload preserves the state (persist).

- [ ] **Step 3: Commit**

```bash
git add app/workspace/layout.tsx components/workspace/Sidebar.tsx
git commit -m "feat: collapsible chains sidebar"
```

---

## Task 13: Collapsible node palette

**Files:**
- Modify: `components/editor/NodePalette.tsx`

- [ ] **Step 1: Add collapse** — read `paletteCollapsed`/`togglePalette` from `useWorkspaceUiStore`. When collapsed, render a 28px rail with a `PanelLeftOpen` button; when expanded, render today's palette plus a small collapse button (`PanelLeftClose`) at the top.

Add at the top of the component:

```tsx
import { useWorkspaceUiStore } from '@/hooks/store/useWorkspaceUiStore'
import { PanelLeftOpen, PanelLeftClose } from 'lucide-react'
// inside component, before the return:
const { paletteCollapsed, togglePalette } = useWorkspaceUiStore()
if (paletteCollapsed) {
  return (
    <div className="w-7 shrink-0 border-r border-zinc-100 bg-white flex flex-col items-center py-2">
      <button onClick={togglePalette} className="p-1.5 text-zinc-400 hover:text-zinc-700" title="Show nodes"><PanelLeftOpen size={16} /></button>
    </div>
  )
}
```

And add a collapse button inside the expanded palette header (just above the search input):

```tsx
<div className="flex items-center justify-between mb-2">
  <span className="text-[9px] font-bold text-zinc-400 uppercase tracking-widest">Nodes</span>
  <button onClick={togglePalette} className="text-zinc-400 hover:text-zinc-700" title="Hide nodes"><PanelLeftClose size={14} /></button>
</div>
```

- [ ] **Step 2: Manual verify** — palette collapses to a rail and restores; persists across reload.

- [ ] **Step 3: Commit**

```bash
git add components/editor/NodePalette.tsx
git commit -m "feat: collapsible node palette"
```

---

## Task 14: Canvas — store-driven highlighting, selection, instance overlay

**Files:**
- Modify: `components/editor/ChainCanvas.tsx`
- Modify: `components/editor/ChainEditor.tsx`

**Interfaces:**
- Consumes: `useRunStore` (`runsByKey`), `nodeRunOf`, `useSelectionStore`, `runKey`, `InstanceSwitcher`.

- [ ] **Step 1: ChainEditor — derive node `run` from the store and report selection.** In `components/editor/ChainEditor.tsx`:
  - Remove local `runState`/`setRunState`, `running`, `runError`, `seedPrompt` state and the `run` callback and the top run bar JSX (`ChainEditor.tsx:200-218`). The header (Task 16) now owns Run.
  - Compute `const fileKey = runKey('chain', slug)` and `const rec = useRunStore(s => s.runsByKey[fileKey])`.
  - In `buildData`, set `run: nodeRunOf(rec, node.id)` instead of `runState[node.id]`.
  - In `selectIds`, after updating local `selectedIds`, also call `useSelectionStore.getState().setSelectedNodeId(ids[0] ?? null)`.
  - Keep the autosave pipeline (`setContent`/`flush`) — Task 16's Run uses `flush` via `beforeRun`. Export a way for the header to call it: lift `flush` by having ChainEditor expose nothing new; instead the header serializes through the same autosave hook (see Task 16, which calls `useRunStore.run` with a `beforeRun` that the page provides). Simplest: keep `flush` usage inside ChainEditor by having ChainEditor render the Run button is **not** wanted; instead move save-then-run responsibility to the autosave already flushing on change + an explicit `flush` call in the header. **Decision:** the header calls `run({ ..., beforeRun: async () => { await flushRef.current?.() } })`; ChainEditor writes its `flush` into a shared ref passed down from the page. Add prop `registerFlush?: (fn: () => Promise<void>) => void` to ChainEditor and call `registerFlush?.(flush)` in an effect.

```tsx
// ChainEditor props: add registerFlush?: (fn: () => Promise<void>) => void
useEffect(() => { registerFlush?.(async () => { await flush(serializeChain(meta, nodes, edges)) }) }, [registerFlush, flush, meta, nodes, edges])
```

- [ ] **Step 2: ChainCanvas — instance switcher overlay.** Add an absolutely-positioned `InstanceSwitcher` over the canvas (top-right), and write selection to the store. Add prop `fileKey: string`. Inside the `<div className="w-full h-full ...">` wrapper, after `</ReactFlowProvider>`-adjacent content, add:

```tsx
import InstanceSwitcher from '@/components/workspace/panel/InstanceSwitcher'
// in the wrapper div (which must be position-relative):
<div className="absolute top-2 right-2 z-10 bg-white/90 border border-zinc-200 rounded-md shadow-sm">
  <InstanceSwitcher fileKey={props.fileKey} />
</div>
```

Make the wrapper `className="w-full h-full bg-zinc-50 relative"`.

- [ ] **Step 3: Manual verify**

Run a chain via the (temporary) old button or after Task 16. Click nodes → Output tab follows. Set Parallel 2 and run → canvas switcher appears; switching instances re-colors dots. Graph dots update live.

- [ ] **Step 4: Commit**

```bash
git add components/editor/ChainCanvas.tsx components/editor/ChainEditor.tsx
git commit -m "feat: store-driven graph highlighting, selection, instance overlay"
```

---

## Task 15: Mount DockablePanel + per-view wiring in the page

**Files:**
- Modify: `app/workspace/page.tsx`

**Interfaces:**
- Consumes: `DockablePanel`, `OutputTab`, `ValidationTab`, `HistoryTab`, `InstanceSwitcher`, `useWorkspaceUiStore`, `useRunStore`, `runKey`, `validateChain` (for the Validation tab issues on chains).

- [ ] **Step 1: Compute per-view panel config.** In `WorkspaceContent`, after computing `parsedChain`, derive:

```tsx
const fileKey = runKey(type ?? '', slug ?? '')
const runnable = type === 'chain' || type === 'agent'
const isChain = type === 'chain'
const validation = useMemo(() => (isChain && parsedChain ? validateChain({ ...parsedChain, filePath: '' }, editorAgents) : { issues: [] as any[], valid: true }), [isChain, parsedChain, editorAgents])
const outputMode: 'graph' | 'stack' | 'single' = type === 'agent' ? 'single' : (isChain && chainView === 'graph') ? 'graph' : 'stack'
const hiddenTabs = runnable ? (type === 'agent' ? ['validation'] as const : []) : (['output', 'validation'] as const)
```

- [ ] **Step 2: Render the panel** inside the main content area as a sibling of the canvas/editor, laid out per `panelDock`. Replace the old `isOutputVisible`/`isHistoryVisible` `<Group>` panels block with:

```tsx
const panelDock = useWorkspaceUiStore((s) => s.panelDock)
// ...
<div className={`flex-1 min-h-0 flex ${panelDock === 'bottom' ? 'flex-col' : 'flex-row'}`}>
  <div className="flex-1 min-h-0 min-w-0">{/* existing graph/YAML editor block */}</div>
  <DockablePanel
    hiddenTabs={[...hiddenTabs]}
    switcher={<InstanceSwitcher fileKey={fileKey} />}
    tabs={{
      output: runnable ? <OutputTab fileKey={fileKey} mode={outputMode} singleNodeId={type === 'agent' ? slug! : undefined} /> : undefined,
      validation: isChain ? <ValidationTab issues={validation.issues} /> : undefined,
      history: <HistoryTab entityType={type!} slug={slug!} />,
    }}
  />
</div>
```

- [ ] **Step 3: Delete dead code** — remove `runsByFile`, `runSingleInstance`, `handleRun`'s console-specific bits, `isOutputVisible`, `isHistoryVisible`, the Output console JSX, the History `<Panel>`, the `Columns2`/`History` toggle buttons, and the `AgentStreamOutput` import (it now lives only in `HistoryTab`).

- [ ] **Step 4: Manual verify**

For a chain (graph + YAML), an agent, and a template: the panel shows the right tabs (Validation hidden for agents; Output/Validation hidden for templates → History only).

- [ ] **Step 5: Commit**

```bash
git add app/workspace/page.tsx
git commit -m "feat: mount dockable panel + per-view wiring; remove side console"
```

---

## Task 16: One-line header + single Run

**Files:**
- Modify: `app/workspace/page.tsx`

**Interfaces:**
- Consumes: `useRunStore` (`inputsByKey`, `setSeed`, `setParallel`, `run`), `useWorkspaceUiStore` (`togglePanel`, `openPanelTab`), `runKey`.

- [ ] **Step 1: Replace the toolbar + Graph/YAML row with one line.** Build a single header row containing: title (`slug.replace(/-/g,' ')`), Graph/YAML toggle (chains only), a single-line seed input with a click-to-expand popover, Parallel number, the **single Run** button, autosave status, and a panel toggle. Wire Run:

```tsx
const flushRef = useRef<(() => Promise<void>) | null>(null)
const inputs = useRunStore((s) => s.inputsByKey[fileKey]) ?? { seedPrompt: '', parallelCount: 1 }
const running = useRunStore((s) => s.runsByKey[fileKey]?.running ?? false)
const { setSeed, setParallel, run } = useRunStore()
const openPanelTab = useWorkspaceUiStore((s) => s.openPanelTab)

async function handleRun() {
  if (!type || !slug || !runnable) return
  openPanelTab('output')
  await run({ key: fileKey, type, slug, beforeRun: async () => { await flushRef.current?.() } })
  if (useRunStore.getState().runsByKey[fileKey]?.error) openPanelTab('validation') // a3
}
```

Header JSX (one line; seed grows, everything stays on one row):

```tsx
<div className="px-4 py-2 border-b border-zinc-100 flex items-center gap-3 bg-white">
  <div className="h-6 w-1 bg-zinc-900 rounded-full" />
  <h1 className="text-sm font-bold text-zinc-900 capitalize whitespace-nowrap">{slug.replace(/-/g, ' ')}</h1>
  {isChain && (
    <div className="flex items-center gap-1">
      <button onClick={() => setChainView('graph')} className={chainView === 'graph' ? 'px-2 py-0.5 text-xs rounded bg-zinc-900 text-white' : 'px-2 py-0.5 text-xs rounded border border-zinc-200 text-zinc-500'}>Graph</button>
      <button onClick={() => setChainView('yaml')} className={chainView === 'yaml' ? 'px-2 py-0.5 text-xs rounded bg-zinc-900 text-white' : 'px-2 py-0.5 text-xs rounded border border-zinc-200 text-zinc-500'}>YAML</button>
    </div>
  )}
  {runnable && (
    <>
      <SeedField value={inputs.seedPrompt} onChange={(v) => setSeed(fileKey, v)} />
      <label className="text-[10px] font-bold text-zinc-400 uppercase tracking-widest">Parallel</label>
      <input type="number" min={1} max={10} value={inputs.parallelCount}
        onChange={(e) => setParallel(fileKey, parseInt(e.target.value) || 1)}
        className="w-12 px-2 py-1 text-xs border border-zinc-200 rounded" />
      <button onClick={handleRun} disabled={running}
        className="flex items-center gap-2 px-4 py-1.5 bg-zinc-900 text-white text-sm font-medium rounded-md hover:bg-zinc-800 disabled:opacity-50">
        <Play size={14} className="fill-current" /> {running ? 'Running…' : 'Run'}
      </button>
      <span className="text-[10px] font-bold text-zinc-400 uppercase tracking-widest">{status}</span>
    </>
  )}
  <div className="flex-1" />
  <button onClick={useWorkspaceUiStore.getState().togglePanel} className="p-1.5 rounded-md border border-zinc-200 text-zinc-500 hover:bg-zinc-50" title="Toggle panel"><Columns2 size={16} /></button>
</div>
```

- [ ] **Step 2: Add the `SeedField` click-to-expand component** (inline in the page file or `components/workspace/SeedField.tsx`): a single-line `<input>` that, on focus/click of an expand affordance, shows a `<textarea>` popover (absolute, below the field). Collapses on blur/escape.

```tsx
function SeedField({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const [open, setOpen] = useState(false)
  return (
    <div className="relative flex-1 min-w-[120px]">
      <input value={value} onChange={(e) => onChange(e.target.value)} placeholder="Seed prompt ({input})…"
        className="w-full text-xs border border-zinc-200 rounded px-2 py-1" />
      <button onClick={() => setOpen((o) => !o)} className="absolute right-1 top-1/2 -translate-y-1/2 text-zinc-400 hover:text-zinc-700" title="Expand"><Maximize2 size={12} /></button>
      {open && (
        <div className="absolute z-30 top-full left-0 mt-1 w-[480px] max-w-[60vw] bg-white border border-zinc-200 rounded-md shadow-lg p-2">
          <textarea autoFocus value={value} onChange={(e) => onChange(e.target.value)} onKeyDown={(e) => e.key === 'Escape' && setOpen(false)}
            className="w-full h-40 text-sm border border-zinc-100 rounded p-2 resize-none focus:outline-none" placeholder="Enter initial instructions or data…" />
        </div>
      )}
    </div>
  )
}
```

Add imports: `Maximize2` from `lucide-react`; pass `registerFlush={(fn) => { flushRef.current = fn }}` to `<ChainEditor>`.

- [ ] **Step 3: Manual verify**

One header line only; a single Run button; seed expands on click; Parallel works; running shows live dots + Output; an invalid chain run flips the panel to Validation with the error banner.

- [ ] **Step 4: Commit**

```bash
git add app/workspace/page.tsx components/workspace/SeedField.tsx
git commit -m "feat: one-line header with single Run + click-to-expand seed"
```

---

## Task 17: Delete obsolete components + final sweep

**Files:**
- Delete: `components/editor/ValidationPanel.tsx`, `components/editor/NodePreview.tsx`, `components/workspace/HistoryPane.tsx` (after confirming no remaining imports).
- Modify: `components/editor/ChainEditor.tsx` — remove the now-unused `ValidationPanel`/`NodePreview` imports and their JSX (`ChainEditor.tsx:246-249`).

- [ ] **Step 1: Find stragglers**

Run: `npx grep -rn "ValidationPanel\|NodePreview\|HistoryPane\|isOutputVisible\|runsByFile" app components` (or use the editor search). Expected: only the definitions about to be deleted.

- [ ] **Step 2: Delete + fix imports**, then:

Run: `npx tsc --noEmit` → no errors. `npm run test:run` → all green. `npm run lint` → clean.

- [ ] **Step 3: Manual verify** the full flow once more (chain graph + YAML, agent, template), including collapse-everything "focus mode", dock flip to right, resize, reload persistence.

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "chore: remove obsolete panel components; final sweep"
```

---

## Self-Review (author checklist — completed)

**Spec coverage:**
- One-line header → Task 16. Single Run / unified engine → Tasks 3, 16. Collapsible sidebar → Task 12. Collapsible palette → Task 13. Dockable panel (Output·Validation·History, dock/collapse/resize) → Tasks 7, 15. Output=clicked node → Task 9. Validation tab + a3 auto-switch → Tasks 10, 16. History + version diff (a1) → Tasks 6, 11. Instance switcher → Tasks 8, 14, 15. Nodes lose output → Task 5. Zustand stores + persistence (a2) → Tasks 2, 3, 4. Run survives navigation (a4) → Task 3 (store-owned). Per-view matrix → Task 15. Non-runnable = History only (a1) → Task 15 `hiddenTabs`. Seed click-to-expand (a5) → Task 16. Agent = one-node → Tasks 9, 15. All covered.

**Placeholder scan:** UI tasks that relocate existing components (11, 12, 13, 15, 16) reference the concrete source files and give the key code; no `TBD`/`add error handling`-style gaps. Logic tasks (1, 2, 3, 6) have full code + tests.

**Type consistency:** `RunRecord`/`RunInstanceState`/`emptyInstance`/`applyEventToInstance`/`nodeRunOf` (Task 1) are consumed unchanged in Tasks 3, 9, 14. `runKey`, `inputsOf` (Task 3) consumed in 8, 14, 15, 16. `DockSide`/`PanelTab`/`openPanelTab` (Task 2) consumed in 7, 12, 13, 15, 16. `selectedNodeId`/`setSelectedNodeId` (Task 4) consumed in 9, 10, 14. `diffLines`/`DiffLine` (Task 6) consumed in 11. Consistent.

**Out of scope (unchanged):** no `/api/run` semantic changes; live-reconnect-after-reload not attempted; graph topology stays in `ChainEditor`.
