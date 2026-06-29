# Workspace QoL Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Collapse the workspace editor's stacked toolbars into one header line, unify the two Run buttons into a single store-owned run engine, and merge the bottom preview + validation + output console + history into one dockable, collapsible, tabbed panel.

**Architecture:** Three Zustand stores own cross-component state — `useRunStore` (run lifecycle + 2D per-instance/per-node results, not persisted), `useSelectionStore` (primary selected node, not persisted), `useWorkspaceUiStore` (panel/sidebar/palette layout, persisted to localStorage). The editor reducer in `ChainEditor` remains the source of truth for graph topology + selection + clipboard and mirrors its primary selection into `useSelectionStore`. A single page-level `DockPanel` reads all three stores and is the only output surface.

**Tech Stack:** Next.js 16.2.2 (App Router, React 19.2.4), Zustand 5.0.12, `@xyflow/react` 12.10.2, `react-resizable-panels` 4.9.0, Tailwind 4, Vitest 4 (pure-logic assert-scripts).

**Spec:** `docs/maestro/plans/2026-06-29-workspace-qol-redesign-design.md` — read it before starting. This plan implements that design verbatim; section refs below (§2, §5, §7, a1–a5) point into it.

## Global Constraints

- **Next.js 16 / React 19:** read `.agents/skills/nextjs16.md` before any store/client-component work. Every component that uses a hook or store needs `'use client'` at the top.
- **React Flow v12 (`@xyflow/react`):** read `.agents/skills/xyflow12.md` before touching `ChainCanvas`/nodes. Named imports only; no direct node mutation; `NodeProps<Node<EditorNodeData>>` typing.
- **Tests are pure-logic assert-scripts** living in `tests/` (flat dir), matching the existing style in `tests/run-state.test.ts`: top-level `import assert from 'node:assert'`, top-level assertions, final `console.log('✅ … passed')`. **No `describe`/`it`/`expect`.** Run one file with `npx vitest run tests/<name>.test.ts`. There is **no component/DOM test infra** — UI wiring is verified by running `npm run dev` and observing, per each UI task's manual-verify step.
- **Store pattern:** follow `hooks/store/useToastStore.ts` (`create<T>((set) => …)`). For the persisted store use `persist` middleware from `zustand/middleware`.
- **Keying:** all per-file state is keyed by `` `${type}:${slug}` `` (the existing `currentFileKey` convention in `app/workspace/page.tsx:87`).
- **Commit after every task** (each task ends in a commit step). Frequent commits; DRY; YAGNI; TDD where logic is pure.
- **B/C already landed** on `master`: inline-graph `/api/run`, editor reducer + undo/redo, `runUpTo` partial run, subchain, file-watch. Build directly on current `master` (verify each cited line still matches before editing).

---

## File map

**New files**

| File | Responsibility |
|---|---|
| `lib/runModel.ts` | Pure 2D run-state model: `InstanceRunMap` + `applyInstanceEvent` (wraps existing `applyRunEvent`). |
| `lib/tabClamp.ts` | Pure `clampTab(persisted, available)` for the hydrate guard (§7). |
| `hooks/store/useRunStore.ts` | Run lifecycle + results keyed by `type:slug`; owns the `run()` fan-out action + run-target registry. |
| `hooks/store/useSelectionStore.ts` | Primary selected `nodeId` keyed by `type:slug` (write-through mirror). |
| `hooks/store/useWorkspaceUiStore.ts` | Panel dock/collapse/size/active-tab + sidebar/palette collapsed; `persist` → localStorage. |
| `components/workspace/DockPanel.tsx` | The merged dockable panel shell: tabs, dock side, collapse, resize, instance switcher, run-error banner. |
| `components/workspace/OutputTab.tsx` | Output tab body (clicked node / all-nodes / synthesized node, per the matrix), honors current instance. |
| `components/workspace/InstanceSwitcher.tsx` | `‹ i/N ›` control (used in canvas overlay + panel header). |
| `components/editor/InterfacePopover.tsx` | "Interface ▾" header popover wrapping the existing `InterfacePanel` body (chains only). |

**Modified files**

| File | Change |
|---|---|
| `app/workspace/page.tsx` | One-line header; delete `runsByFile`/`handleRun`/`runSingleInstance` + side console + output/history toggles; mount `DockPanel`; agent/YAML register run target + call `useRunStore.run`. |
| `app/workspace/layout.tsx` | Collapsible sidebar panel driven by `useWorkspaceUiStore`. |
| `components/editor/ChainEditor.tsx` | Remove local run useState + `streamInline`; register run target; call `useRunStore.run`; mirror selection to `useSelectionStore`; remove bottom `ValidationPanel`/`InterfacePanel`/`NodePreview`; keep file-watch banner under header. |
| `components/editor/ChainCanvas.tsx` | Instance-switcher overlay; node `run` comes from current-instance slice. |
| `components/editor/nodes/AgentNode.tsx` | Remove inline output block (`:72-76`). |
| `components/editor/NodePalette.tsx` | Collapsible to a rail via `useWorkspaceUiStore`. |
| `components/workspace/Sidebar.tsx` | Collapse affordance (rail) via `useWorkspaceUiStore`. |

**Deleted files**

| File | Reason |
|---|---|
| `components/editor/NodePreview.tsx` | Replaced by the Output tab. |

---

## Phase A — Stores foundation

### Task A1: Pure 2D run-state model

**Files:**
- Create: `lib/runModel.ts`
- Test: `tests/run-model.test.ts`

**Interfaces:**
- Consumes: `applyRunEvent`, `RunStateMap`, `NodeRunState` from `lib/runState.ts`; `RunEvent` from `lib/runStream.ts`.
- Produces:
  - `type InstanceRunMap = Record<number, RunStateMap>`
  - `applyInstanceEvent(map: InstanceRunMap, instance: number, e: RunEvent): InstanceRunMap`
  - `nodeStateFor(map: InstanceRunMap, instance: number, nodeId: string): NodeRunState | undefined`

- [ ] **Step 1: Write the failing test**

```ts
// tests/run-model.test.ts
import assert from 'node:assert'
import { applyInstanceEvent, nodeStateFor, InstanceRunMap } from '../lib/runModel'
import { AgentOutput } from '../lib/types'

function out(o: Partial<{ output: string; status: string; round: number; agentName: string }>) {
  return { agentName: 'w', systemPrompt: '', input: '', output: '', thought: '', tokensIn: 0,
    tokensOut: 0, costUsd: 0, latencyMs: 0, model: 'm', timestamp: '', status: 'success', ...o } as unknown as AgentOutput
}

let m: InstanceRunMap = {}

// two instances accumulate independently under the same nodeId
m = applyInstanceEvent(m, 0, { type: 'agent_start', nodeId: 'a', agentName: 'w', step: 0 })
m = applyInstanceEvent(m, 1, { type: 'agent_start', nodeId: 'a', agentName: 'w', step: 0 })
m = applyInstanceEvent(m, 0, { type: 'token', nodeId: 'a', token: 'zero', step: 0 })
m = applyInstanceEvent(m, 1, { type: 'token', nodeId: 'a', token: 'one', step: 0 })
assert.strictEqual(m[0].a.output, 'zero')
assert.strictEqual(m[1].a.output, 'one')
assert.strictEqual(nodeStateFor(m, 0, 'a')?.output, 'zero')
assert.strictEqual(nodeStateFor(m, 1, 'a')?.output, 'one')

// agent_done routes to the correct instance only
m = applyInstanceEvent(m, 1, { type: 'agent_done', nodeId: 'a', agentName: 'w', step: 0, output: out({ output: 'one', status: 'success' }) })
assert.strictEqual(m[1].a.status, 'success')
assert.strictEqual(m[0].a.status, 'running')

// missing instance / node returns undefined, never throws
assert.strictEqual(nodeStateFor(m, 9, 'a'), undefined)
assert.strictEqual(nodeStateFor(m, 0, 'missing'), undefined)

console.log('✅ run-model tests passed')
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/run-model.test.ts`
Expected: FAIL — cannot resolve `../lib/runModel`.

- [ ] **Step 3: Write minimal implementation**

```ts
// lib/runModel.ts
import { applyRunEvent, RunStateMap, NodeRunState } from './runState'
import { RunEvent } from './runStream'

// 2D: instanceIndex -> nodeId -> NodeRunState (see design §7)
export type InstanceRunMap = Record<number, RunStateMap>

export function applyInstanceEvent(map: InstanceRunMap, instance: number, e: RunEvent): InstanceRunMap {
  const prev = map[instance] ?? {}
  return { ...map, [instance]: applyRunEvent(prev, e) }
}

export function nodeStateFor(map: InstanceRunMap, instance: number, nodeId: string): NodeRunState | undefined {
  return map[instance]?.[nodeId]
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/run-model.test.ts`
Expected: PASS — prints `✅ run-model tests passed`.

- [ ] **Step 5: Commit**

```bash
git add lib/runModel.ts tests/run-model.test.ts
git commit -m "feat: pure 2D per-instance run-state model"
```

---

### Task A2: `useRunStore` — run lifecycle + fan-out

**Files:**
- Create: `hooks/store/useRunStore.ts`
- Test: `tests/run-store.test.ts`

**Interfaces:**
- Consumes: `InstanceRunMap`, `applyInstanceEvent` (A1); `streamRun`, `RunEvent` (`lib/runStream.ts`); `create` from `zustand`.
- Produces:
  - `interface RunTarget { type: string; slug: string; buildBody: (seedPrompt: string) => Record<string, unknown> }`
  - `setRunTarget(key: string, target: RunTarget): void` / `clearRunTarget(key: string): void` (module-level registry, not store state)
  - `interface FileRunState { runState: InstanceRunMap; instanceCount: number; currentInstance: number; running: boolean; error: string | null; seedPrompt: string; parallel: number }`
  - `useRunStore` with: `byFile: Record<string, FileRunState>`, and actions `setSeed(key, seed)`, `setParallel(key, n)`, `setCurrentInstance(key, i)`, `reset(key)`, `run(key, opts?: { bodyOverride?: (seed: string) => Record<string, unknown>; parallel?: number }): Promise<void>`
  - `fileRun(key: string): FileRunState` selector helper exported for consumers (returns defaults when absent).

- [ ] **Step 1: Write the failing test** (covers the fan-out — the riskiest logic — with a mocked SSE `fetch`)

```ts
// tests/run-store.test.ts
import assert from 'node:assert'
import { useRunStore, setRunTarget, fileRun } from '../hooks/store/useRunStore'

function sse(frames: object[]): Response {
  const body = new ReadableStream<Uint8Array>({
    start(c) {
      const enc = new TextEncoder()
      for (const f of frames) c.enqueue(enc.encode(`data: ${JSON.stringify(f)}\n\n`))
      c.close()
    },
  })
  return new Response(body, { status: 200 })
}

const KEY = 'chain:demo'
const done = (output: string) => ({
  agentName: 'w', systemPrompt: '', input: '', output, thought: '', tokensIn: 0, tokensOut: 0,
  costUsd: 0, latencyMs: 0, model: 'm', timestamp: '', status: 'success',
})

await (async () => {
  // each instance gets its own stream; tag output with the instance index so we can assert routing
  let call = -1
  // @ts-expect-error - override global fetch for the test
  global.fetch = async () => {
    call += 1
    const tag = `i${call}`
    return sse([
      { type: 'agent_start', nodeId: 'a', agentName: 'w', step: 0 },
      { type: 'token', nodeId: 'a', token: tag, step: 0 },
      { type: 'agent_done', nodeId: 'a', agentName: 'w', step: 0, output: done(tag) },
    ])
  }

  setRunTarget(KEY, { type: 'chain', slug: 'demo', buildBody: (seed) => ({ seedPrompt: seed }) })
  useRunStore.getState().setSeed(KEY, 'hi')
  useRunStore.getState().setParallel(KEY, 2)

  await useRunStore.getState().run(KEY)

  const f = fileRun(KEY)
  assert.strictEqual(f.running, false)
  assert.strictEqual(f.instanceCount, 2)
  assert.strictEqual(f.error, null)
  // both instances completed, outputs are independent per instance
  assert.strictEqual(f.runState[0].a.status, 'success')
  assert.strictEqual(f.runState[1].a.status, 'success')
  assert.notStrictEqual(f.runState[0].a.output, f.runState[1].a.output)

  // reset clears results
  useRunStore.getState().reset(KEY)
  assert.deepStrictEqual(fileRun(KEY).runState, {})
})()

await (async () => {
  // run-level failure: non-ok response sets error and leaves running=false
  // @ts-expect-error - override global fetch
  global.fetch = async () => new Response(JSON.stringify({ error: 'bad chain' }), { status: 400 })
  setRunTarget('chain:bad', { type: 'chain', slug: 'bad', buildBody: () => ({}) })
  useRunStore.getState().setParallel('chain:bad', 1)
  await useRunStore.getState().run('chain:bad')
  const f = fileRun('chain:bad')
  assert.strictEqual(f.running, false)
  assert.strictEqual(f.error, 'bad chain')
})()

console.log('✅ run-store tests passed')
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/run-store.test.ts`
Expected: FAIL — cannot resolve `../hooks/store/useRunStore`.

- [ ] **Step 3: Write minimal implementation**

```ts
// hooks/store/useRunStore.ts
import { create } from 'zustand'
import { InstanceRunMap, applyInstanceEvent } from '@/lib/runModel'
import { streamRun } from '@/lib/runStream'

export interface RunTarget {
  type: string
  slug: string
  buildBody: (seedPrompt: string) => Record<string, unknown>
}

// Module-level registry (not store state) so the live graph getter isn't serialized.
// Replaces the old registerFlush seam (design §2).
const targets = new Map<string, RunTarget>()
export function setRunTarget(key: string, target: RunTarget) { targets.set(key, target) }
export function clearRunTarget(key: string) { targets.delete(key) }

export interface FileRunState {
  runState: InstanceRunMap
  instanceCount: number
  currentInstance: number
  running: boolean
  error: string | null
  seedPrompt: string
  parallel: number
}

const defaults = (): FileRunState => ({
  runState: {}, instanceCount: 0, currentInstance: 0, running: false, error: null, seedPrompt: '', parallel: 1,
})

interface RunStore {
  byFile: Record<string, FileRunState>
  setSeed: (key: string, seed: string) => void
  setParallel: (key: string, n: number) => void
  setCurrentInstance: (key: string, i: number) => void
  reset: (key: string) => void
  run: (key: string, opts?: { bodyOverride?: (seed: string) => Record<string, unknown>; parallel?: number }) => Promise<void>
}

export const useRunStore = create<RunStore>((set, get) => {
  const patch = (key: string, p: Partial<FileRunState>) =>
    set((s) => ({ byFile: { ...s.byFile, [key]: { ...(s.byFile[key] ?? defaults()), ...p } } }))

  return {
    byFile: {},
    setSeed: (key, seed) => patch(key, { seedPrompt: seed }),
    setParallel: (key, n) => patch(key, { parallel: Math.max(1, Math.min(10, n || 1)) }),
    setCurrentInstance: (key, i) => patch(key, { currentInstance: i }),
    reset: (key) => patch(key, { runState: {}, instanceCount: 0, currentInstance: 0, error: null }),

    run: async (key, opts) => {
      const target = targets.get(key)
      if (!target) return
      const cur = get().byFile[key] ?? defaults()
      const n = opts?.parallel ?? cur.parallel
      const buildBody = opts?.bodyOverride ?? target.buildBody
      const seed = cur.seedPrompt

      patch(key, { runState: {}, instanceCount: n, currentInstance: 0, running: true, error: null })

      const runOne = async (i: number) => {
        try {
          const res = await fetch('/api/run', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(buildBody(seed)),
          })
          if (!res.ok) {
            const b = await res.json().catch(() => ({}))
            patch(key, { error: (b.errors as string[] | undefined)?.join('; ') ?? b.error ?? `Run failed (${res.status})` })
            return
          }
          const reader = res.body?.getReader()
          if (!reader) return
          await streamRun(reader, (e) => {
            if (e.type === 'error') { patch(key, { error: e.error }); return }
            set((s) => {
              const f = s.byFile[key] ?? defaults()
              return { byFile: { ...s.byFile, [key]: { ...f, runState: applyInstanceEvent(f.runState, i, e) } } }
            })
          })
        } catch (err) {
          patch(key, { error: err instanceof Error ? err.message : String(err) })
        }
      }

      await Promise.all(Array.from({ length: n }, (_, i) => runOne(i)))
      patch(key, { running: false })
    },
  }
})

export function fileRun(key: string): FileRunState {
  return useRunStore.getState().byFile[key] ?? defaults()
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/run-store.test.ts`
Expected: PASS — prints `✅ run-store tests passed`.

- [ ] **Step 5: Commit**

```bash
git add hooks/store/useRunStore.ts tests/run-store.test.ts
git commit -m "feat: useRunStore — store-owned run with N-stream fan-out"
```

---

### Task A3: `useSelectionStore` — primary selected node

**Files:**
- Create: `hooks/store/useSelectionStore.ts`
- Test: `tests/selection-store.test.ts`

**Interfaces:**
- Produces: `useSelectionStore` with `byFile: Record<string, string | null>`, `setSelected(key, nodeId)`, and selector helper `selectedNodeId(key): string | null`.

- [ ] **Step 1: Write the failing test**

```ts
// tests/selection-store.test.ts
import assert from 'node:assert'
import { useSelectionStore, selectedNodeId } from '../hooks/store/useSelectionStore'

assert.strictEqual(selectedNodeId('chain:a'), null)
useSelectionStore.getState().setSelected('chain:a', 'node-1')
useSelectionStore.getState().setSelected('chain:b', 'node-2')
assert.strictEqual(selectedNodeId('chain:a'), 'node-1')
assert.strictEqual(selectedNodeId('chain:b'), 'node-2')
useSelectionStore.getState().setSelected('chain:a', null)
assert.strictEqual(selectedNodeId('chain:a'), null)

console.log('✅ selection-store tests passed')
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/selection-store.test.ts`
Expected: FAIL — cannot resolve module.

- [ ] **Step 3: Write minimal implementation**

```ts
// hooks/store/useSelectionStore.ts
import { create } from 'zustand'

interface SelectionStore {
  byFile: Record<string, string | null>
  setSelected: (key: string, nodeId: string | null) => void
}

export const useSelectionStore = create<SelectionStore>((set) => ({
  byFile: {},
  setSelected: (key, nodeId) => set((s) => ({ byFile: { ...s.byFile, [key]: nodeId } })),
}))

export function selectedNodeId(key: string): string | null {
  return useSelectionStore.getState().byFile[key] ?? null
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/selection-store.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add hooks/store/useSelectionStore.ts tests/selection-store.test.ts
git commit -m "feat: useSelectionStore — write-through mirror of primary selection"
```

---

### Task A4: `clampTab` + `useWorkspaceUiStore` (persisted)

**Files:**
- Create: `lib/tabClamp.ts`, `hooks/store/useWorkspaceUiStore.ts`
- Test: `tests/tab-clamp.test.ts`

**Interfaces:**
- Produces:
  - `type PanelTab = 'output' | 'validation' | 'history'`
  - `clampTab(persisted: PanelTab, available: PanelTab[]): PanelTab` — returns `persisted` if available, else first available, else `'history'`.
  - `type DockSide = 'bottom' | 'right'`
  - `useWorkspaceUiStore` with: `dockSide`, `panelCollapsed`, `panelSize` (number, px), `activeTab: PanelTab`, `sidebarCollapsed`, `paletteCollapsed`, and setters `setDockSide`, `togglePanel`, `setPanelSize`, `setActiveTab`, `toggleSidebar`, `togglePalette`. Persisted under key `maestro_workspace_ui`.

- [ ] **Step 1: Write the failing test** (TDD the pure clamp; the store itself is verified manually)

```ts
// tests/tab-clamp.test.ts
import assert from 'node:assert'
import { clampTab } from '../lib/tabClamp'

assert.strictEqual(clampTab('validation', ['output', 'validation', 'history']), 'validation')
// agent view: no validation tab -> fall back to first available
assert.strictEqual(clampTab('validation', ['output', 'history']), 'output')
// non-runnable view: history only
assert.strictEqual(clampTab('output', ['history']), 'history')
// empty (defensive) -> history
assert.strictEqual(clampTab('output', []), 'history')

console.log('✅ tab-clamp tests passed')
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/tab-clamp.test.ts`
Expected: FAIL — cannot resolve `../lib/tabClamp`.

- [ ] **Step 3: Write minimal implementation**

```ts
// lib/tabClamp.ts
export type PanelTab = 'output' | 'validation' | 'history'

export function clampTab(persisted: PanelTab, available: PanelTab[]): PanelTab {
  if (available.includes(persisted)) return persisted
  return available[0] ?? 'history'
}
```

```ts
// hooks/store/useWorkspaceUiStore.ts
import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import type { PanelTab } from '@/lib/tabClamp'

export type DockSide = 'bottom' | 'right'

interface WorkspaceUiStore {
  dockSide: DockSide
  panelCollapsed: boolean
  panelSize: number
  activeTab: PanelTab
  sidebarCollapsed: boolean
  paletteCollapsed: boolean
  setDockSide: (s: DockSide) => void
  togglePanel: () => void
  setPanelSize: (px: number) => void
  setActiveTab: (t: PanelTab) => void
  toggleSidebar: () => void
  togglePalette: () => void
}

export const useWorkspaceUiStore = create<WorkspaceUiStore>()(
  persist(
    (set) => ({
      dockSide: 'bottom',
      panelCollapsed: false,
      panelSize: 30, // percent of the editor area (the parent react-resizable Panel owns sizing)
      activeTab: 'output',
      sidebarCollapsed: false,
      paletteCollapsed: false,
      setDockSide: (s) => set({ dockSide: s }),
      togglePanel: () => set((st) => ({ panelCollapsed: !st.panelCollapsed })),
      setPanelSize: (n) => set({ panelSize: Math.max(10, Math.min(80, n)) }),
      setActiveTab: (t) => set({ activeTab: t }),
      toggleSidebar: () => set((st) => ({ sidebarCollapsed: !st.sidebarCollapsed })),
      togglePalette: () => set((st) => ({ paletteCollapsed: !st.paletteCollapsed })),
    }),
    { name: 'maestro_workspace_ui' },
  ),
)
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/tab-clamp.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/tabClamp.ts hooks/store/useWorkspaceUiStore.ts tests/tab-clamp.test.ts
git commit -m "feat: useWorkspaceUiStore (persisted) + clampTab hydrate guard"
```

---

## Phase B — Unified run engine

### Task B1: Wire `ChainEditor` to the run store + mirror selection

**Files:**
- Modify: `components/editor/ChainEditor.tsx`

**Interfaces:**
- Consumes: `useRunStore`, `setRunTarget`, `clearRunTarget`, `fileRun` (A2); `useSelectionStore` (A3); `nodeStateFor` (A1).
- Produces: nothing new; this removes `streamInline`/local run useState and routes run through the store.

This task replaces the editor's local run state with the store. The bottom panels (`ValidationPanel`, `InterfacePanel`, `NodePreview`) are removed here too — their replacements arrive in Phase C/D, so between B1 and C the validation/output surface is temporarily absent in graph view (acceptable mid-plan; the run button + graph dots still work).

- [ ] **Step 1: Add store imports** — replace the run-stream import block.

Replace:
```ts
import { streamRun } from '@/lib/runStream'
import { applyRunEvent, type RunStateMap } from '@/lib/runState'
import NodePreview from './NodePreview'
import InterfacePanel from './InterfacePanel'
```
with:
```ts
import { useRunStore, setRunTarget, clearRunTarget } from '@/hooks/store/useRunStore'
import { useSelectionStore } from '@/hooks/store/useSelectionStore'
```
(The current-instance slice is read directly off the store in Step 2, so no `runModel` import is needed here.)
Also remove the now-unused `ValidationPanel` import if no longer referenced after Step 5 (keep until then).

- [ ] **Step 2: Replace local run state with store reads.**

Delete these lines:
```ts
  const [runState, setRunState] = useState<RunStateMap>({})
  const [seedPrompt, setSeedPrompt] = useState(initialSeedPrompt ?? '')
  const [running, setRunning] = useState(false)
  const [runError, setRunError] = useState<string | null>(null)
```
Add (after `const primaryId = …`):
```ts
  const fileKey = `chain:${slug}`
  const file = useRunStore(s => s.byFile[fileKey])
  const running = file?.running ?? false
  const currentInstance = file?.currentInstance ?? 0
  const runState = file ? (file.runState[currentInstance] ?? {}) : {}
```
Seed the store's seed prompt once on mount:
```ts
  useEffect(() => {
    if (initialSeedPrompt) useRunStore.getState().setSeed(fileKey, initialSeedPrompt)
  }, [fileKey, initialSeedPrompt])
```

- [ ] **Step 3: Register the run target; delete `streamInline`/`run`/`runUpTo` local fetch.**

Delete the whole `streamInline` `useCallback`, the `run` `useCallback`, and `runUpTo` `useCallback` (`ChainEditor.tsx:115-138`). Replace with target registration + thin run callbacks:
```ts
  useEffect(() => {
    setRunTarget(fileKey, {
      type: 'chain', slug,
      buildBody: (seedPrompt) => ({
        chain: { name: meta.name, description: meta.description, inputs: iface.inputs, outputs: iface.outputs, nodes, edges },
        seedPrompt, type: 'chain', slug,
      }),
    })
    return () => clearRunTarget(fileKey)
  }, [fileKey, slug, meta, iface, nodes, edges])

  const run = useCallback(() => useRunStore.getState().run(fileKey), [fileKey])
  const runUpTo = useCallback((targetId: string) => {
    const sub = upstreamSubgraph({ ...initialChain, nodes, edges }, targetId)
    // partial run is single-instance (design §2)
    return useRunStore.getState().run(fileKey, {
      parallel: 1,
      bodyOverride: (seedPrompt) => ({
        chain: { name: meta.name, description: meta.description, inputs: iface.inputs, outputs: iface.outputs, nodes: sub.nodes, edges: sub.edges },
        seedPrompt, type: 'chain', slug,
      }),
    })
  }, [fileKey, initialChain, nodes, edges, meta, iface, slug])
```

- [ ] **Step 4: Mirror primary selection into the selection store.** In `setSelectedIds`, add a write-through:
```ts
  const setSelectedIds = useCallback((ids: string[]) => {
    dispatch({ type: 'setSelection', ids })
    useSelectionStore.getState().setSelected(`chain:${slug}`, ids[0] ?? null)
  }, [slug])
```

- [ ] **Step 5: Remove the bottom panels + run-error/run-button JSX that the header/panel will own.**

Delete the bottom three elements (`ValidationPanel`, `InterfacePanel`, `NodePreview` block at `ChainEditor.tsx:270-274`) and the `runError` banner (`:234`) — run-error now surfaces in `DockPanel` (Task C6). Keep the file-watch `conflict` banner. The header seed/run/undo bar (`:202-232`) stays for now and is removed in Task D1. Update `buildData`'s `run:` field to read from the current instance:
```ts
    run: runState[node.id],   // unchanged — runState is now the current-instance slice from Step 2
```
(No code change needed in `buildData` since `runState` was redefined in Step 2; confirm it compiles.)

- [ ] **Step 6: Manual verify**

Run: `npm run dev`, open a chain in Graph view, click Run.
Expected: graph status dots animate and settle (green/red) exactly as before; no `NodePreview`/Validation/Interface strips at the bottom; no console errors. Switch Graph→YAML→Graph mid-run (toggle in `page.tsx`): the run keeps progressing (store-owned, a4).

- [ ] **Step 7: Commit**

```bash
git add components/editor/ChainEditor.tsx
git commit -m "feat: route ChainEditor run through useRunStore; mirror selection"
```

---

### Task B2: `AgentNode` reads current-instance run; remove inline output

**Files:**
- Modify: `components/editor/nodes/AgentNode.tsx`

**Interfaces:**
- Consumes: `EditorNodeData.run` (already the current-instance slice after B1).

- [ ] **Step 1: Remove the inline output block.** Delete `AgentNode.tsx:72-76`:
```tsx
        {run && run.output && (
          <div className="mt-2 text-[10px] text-zinc-600 bg-zinc-50 border border-zinc-100 rounded p-2 max-h-24 overflow-hidden whitespace-pre-wrap">
            {run.output.slice(0, 240)}
          </div>
        )}
```
Leave the status dot (`statusDotClass(run)`) and `run?.status === 'skipped'` opacity untouched.

- [ ] **Step 2: Manual verify**

Run: `npm run dev`, run a chain. Nodes show the status dot only — no text output box stretching the node. Output appears in the panel (after Phase C); for now confirm the node no longer renders output text.

- [ ] **Step 3: Commit**

```bash
git add components/editor/nodes/AgentNode.tsx
git commit -m "feat: remove inline output block from AgentNode (moves to Output tab)"
```

---

### Task B3: Route agent + YAML run through the store in `page.tsx`

**Files:**
- Modify: `app/workspace/page.tsx`

This deletes the entire `runsByFile`/`handleRun`/`runSingleInstance` machinery and the in-memory accumulating run list (design §7). The one-line header (Task D1) reuses the run button added here. Agent and chain-YAML views register a by-name run target.

**Interfaces:**
- Consumes: `useRunStore`, `setRunTarget`, `clearRunTarget`, `fileRun` (A2).

- [ ] **Step 1: Delete dead run state + functions.** Remove `runsByFile`, `currentRuns`, `isExecuting`, `clearAllRuns`, `deleteRun`, `runSingleInstance`, `handleRun`, and the `AgentState`/`RunInstance` interfaces (`page.tsx:21-43, 58, 88-103, 135-294`). Remove now-unused imports `AgentStreamOutput`, `nanoid`, `streamRun`, `RunEvent`, `AgentOutput`, `Trash2`, `Activity`, `Columns2`, `X`.

- [ ] **Step 2: Add store-backed run.** After the `currentFileKey` definition:
```ts
  const file = useRunStore(s => s.byFile[currentFileKey])
  const running = file?.running ?? false

  // Agent + chain-YAML run from disk by name (graph view registers an inline-graph target in ChainEditor).
  useEffect(() => {
    if (!type || !slug) return
    const isGraph = type === 'chain' && chainView === 'graph' && !!parsedChain
    if (isGraph) return // ChainEditor owns the target for graph view
    if (type !== 'agent' && type !== 'chain') return
    setRunTarget(currentFileKey, {
      type, slug,
      buildBody: (seedPrompt) => ({ [type === 'chain' ? 'chainName' : 'agentName']: slug, seedPrompt, type, slug }),
    })
    return () => clearRunTarget(currentFileKey)
  }, [type, slug, chainView, parsedChain, currentFileKey])

  const handleRun = useCallback(() => {
    useRunStore.getState().setSeed(currentFileKey, seedPrompt)
    return useRunStore.getState().run(currentFileKey)
  }, [currentFileKey, seedPrompt])
```
Keep `seedPrompt`/`parallelCount` page useState **only** until Task D1 moves them into the header/store; wire `parallelCount` into the store now:
```ts
  useEffect(() => { useRunStore.getState().setParallel(currentFileKey, parallelCount) }, [currentFileKey, parallelCount])
```

- [ ] **Step 3: Point the toolbar Run button at the new `handleRun`.** Its `onClick={handleRun}` already matches; update its label to use `running`:
```tsx
            {running ? 'Running…' : 'Run'}
```

- [ ] **Step 4: Remove the side Output console panel** (`page.tsx:445-553`, the `{isOutputVisible && (…)}` block) and the History panel block (`:555-566`) — both move into `DockPanel` (Phase C). Remove `isOutputVisible`/`isHistoryVisible` state and their toggle buttons (`:361-383`). The `Group`/`Panel` wrapper collapses to a single full-width editor panel for now:
```tsx
          <div className="h-full flex flex-col">
            {/* chain Graph/YAML toggle + editor (unchanged inner content) */}
          </div>
```
(Replace the `<Group orientation="horizontal">…</Group>` with the single `<div>`; keep the chain view toggle + `ChainEditor`/`FileEditor` switch inside it.)

- [ ] **Step 5: Manual verify**

Run: `npm run dev`. Open an **agent**, set a seed, click Run — no error (output surface returns in Phase C; verify via Network tab that `/api/run` is POSTed with `{agentName, seedPrompt}` and streams 200). Open a **chain in YAML view**, Run — POSTs `{chainName,…}`. Open a chain in **Graph view**, Run — POSTs `{chain:{nodes,edges},…}` (ChainEditor's target). No `runsByFile` references remain (`grep -n runsByFile app/workspace/page.tsx` → empty).

- [ ] **Step 6: Commit**

```bash
git add app/workspace/page.tsx
git commit -m "feat: route agent/YAML run through useRunStore; drop in-memory run list"
```

---

## Phase C — Merged dockable panel

### Task C1: `InstanceSwitcher` control

**Files:**
- Create: `components/workspace/InstanceSwitcher.tsx`

**Interfaces:**
- Produces: `InstanceSwitcher({ count, index, onChange }: { count: number; index: number; onChange: (i: number) => void })` — renders nothing when `count <= 1`.

- [ ] **Step 1: Implement.**
```tsx
'use client'
import React from 'react'
import { ChevronLeft, ChevronRight } from 'lucide-react'

export default function InstanceSwitcher({ count, index, onChange }: {
  count: number; index: number; onChange: (i: number) => void
}) {
  if (count <= 1) return null
  return (
    <div className="flex items-center gap-1 text-[11px] text-zinc-500">
      <button className="p-0.5 hover:text-zinc-900 disabled:opacity-30" disabled={index <= 0}
        onClick={() => onChange(index - 1)} aria-label="Previous instance"><ChevronLeft size={14} /></button>
      <span className="font-mono tabular-nums">{index + 1}/{count}</span>
      <button className="p-0.5 hover:text-zinc-900 disabled:opacity-30" disabled={index >= count - 1}
        onClick={() => onChange(index + 1)} aria-label="Next instance"><ChevronRight size={14} /></button>
    </div>
  )
}
```

- [ ] **Step 2: Manual verify** — defer to C2 (rendered in the panel header). Commit now.

```bash
git add components/workspace/InstanceSwitcher.tsx
git commit -m "feat: InstanceSwitcher control"
```

---

### Task C2: `OutputTab` body

**Files:**
- Create: `components/workspace/OutputTab.tsx`

**Interfaces:**
- Consumes: `fileRun`/`useRunStore` (A2), `nodeStateFor` (A1), `selectedNodeId`/`useSelectionStore` (A3), `NodeRunState` (`lib/runState.ts`).
- Produces: `OutputTab({ fileKey, view }: { fileKey: string; view: 'graph' | 'yaml' | 'agent' })`.

Behavior (design matrix): `graph` → the selected node only (via `useSelectionStore`); `yaml` → all nodes in the current instance, stacked; `agent` → the single synthesized node (`nodeId = slug`, but we just render whatever the instance produced).

- [ ] **Step 1: Implement.**
```tsx
'use client'
import React from 'react'
import { useRunStore } from '@/hooks/store/useRunStore'
import { useSelectionStore } from '@/hooks/store/useSelectionStore'
import type { NodeRunState } from '@/lib/runState'

function NodeOutput({ nodeId, run }: { nodeId: string; run?: NodeRunState }) {
  if (!run) return <div className="px-4 py-2 text-[11px] text-zinc-400 italic">No output for “{nodeId}” yet.</div>
  if (run.status === 'skipped') return <div className="px-4 py-2 text-[11px] text-zinc-400 italic">{nodeId} — skipped (no output)</div>
  return (
    <div className="px-4 py-2">
      <div className="text-[10px] font-bold text-zinc-400 uppercase tracking-widest mb-1">{nodeId} · {run.status}</div>
      {run.rounds.length > 1
        ? run.rounds.map(r => (
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

export default function OutputTab({ fileKey, view }: { fileKey: string; view: 'graph' | 'yaml' | 'agent' }) {
  const file = useRunStore(s => s.byFile[fileKey])
  const selected = useSelectionStore(s => s.byFile[fileKey] ?? null)
  const instance = file?.currentInstance ?? 0
  const map = file?.runState[instance] ?? {}
  const nodeIds = Object.keys(map)

  if (!file || nodeIds.length === 0) {
    return <div className="px-4 py-3 text-[11px] text-zinc-400 italic">No output yet. Click Run to start.</div>
  }
  if (view === 'graph') {
    if (!selected) return <div className="px-4 py-3 text-[11px] text-zinc-400 italic">Select a node to see its output.</div>
    return <NodeOutput nodeId={selected} run={map[selected]} />
  }
  // yaml + agent: stack all nodes in the current instance
  return <div className="divide-y divide-zinc-100">{nodeIds.map(id => <NodeOutput key={id} nodeId={id} run={map[id]} />)}</div>
}
```

- [ ] **Step 2: Manual verify** — defer to C3 (mounted inside `DockPanel`). Commit.

```bash
git add components/workspace/OutputTab.tsx
git commit -m "feat: OutputTab — per-instance node output (graph/yaml/agent)"
```

---

### Task C3: `DockPanel` shell (tabs + dock + collapse + resize + instance switcher + error banner)

**Files:**
- Create: `components/workspace/DockPanel.tsx`

**Interfaces:**
- Consumes: `useWorkspaceUiStore` (A4), `clampTab`/`PanelTab` (A4), `useRunStore`/`fileRun` (A2), `OutputTab` (C2), `InstanceSwitcher` (C1), `ValidationPanel` (`components/editor/ValidationPanel.tsx`), `HistoryPane` (`components/workspace/HistoryPane.tsx`), `ValidationIssue` (`lib/types`).
- Produces: `DockPanel({ type, slug, view, issues, onSelectIssueNode }: { type: string; slug: string; view: 'graph' | 'yaml' | 'agent' | 'none'; issues: ValidationIssue[]; onSelectIssueNode: (id: string | null) => void })`.

Available tabs by view: `graph`/`yaml` → `['output','validation','history']`; `agent` → `['output','history']`; `none` (skill/template/context) → `['history']`.

- [ ] **Step 1: Implement.**
```tsx
'use client'
import React, { useEffect } from 'react'
import { PanelBottom, PanelRight, ChevronDown, ChevronUp } from 'lucide-react'
import { useWorkspaceUiStore } from '@/hooks/store/useWorkspaceUiStore'
import { clampTab, type PanelTab } from '@/lib/tabClamp'
import { useRunStore } from '@/hooks/store/useRunStore'
import type { ValidationIssue } from '@/lib/types'
import OutputTab from './OutputTab'
import InstanceSwitcher from './InstanceSwitcher'
import ValidationPanel from '@/components/editor/ValidationPanel'
import { HistoryPane } from './HistoryPane'

type View = 'graph' | 'yaml' | 'agent' | 'none'

const tabsForView: Record<View, PanelTab[]> = {
  graph: ['output', 'validation', 'history'],
  yaml: ['output', 'validation', 'history'],
  agent: ['output', 'history'],
  none: ['history'],
}

export default function DockPanel({ type, slug, view, issues, onSelectIssueNode }: {
  type: string; slug: string; view: View; issues: ValidationIssue[]; onSelectIssueNode: (id: string | null) => void
}) {
  const fileKey = `${type}:${slug}`
  const ui = useWorkspaceUiStore()
  const available = tabsForView[view]
  const active = clampTab(ui.activeTab, available)

  const file = useRunStore(s => s.byFile[fileKey])
  const error = file?.error ?? null
  const instanceCount = file?.instanceCount ?? 0
  const currentInstance = file?.currentInstance ?? 0

  // a3: run-level error auto-switches to Validation (when available)
  useEffect(() => {
    if (error && available.includes('validation')) useWorkspaceUiStore.getState().setActiveTab('validation')
  }, [error, available])

  const isRight = ui.dockSide === 'right'
  // Size is owned by the parent react-resizable Panel (Task C4/C5); DockPanel just fills it.
  const containerCls = isRight
    ? 'border-l border-zinc-200 h-full flex flex-col'
    : 'border-t border-zinc-200 w-full flex flex-col'

  if (ui.panelCollapsed) {
    return (
      <div className={`${isRight ? 'border-l h-full w-9' : 'border-t w-full h-9'} border-zinc-200 bg-white flex items-center gap-2 px-2`}>
        <button onClick={ui.togglePanel} className="text-zinc-500 hover:text-zinc-900" aria-label="Expand panel">
          {isRight ? <ChevronDown size={16} /> : <ChevronUp size={16} />}
        </button>
        <span className="text-[10px] font-bold text-zinc-400 uppercase tracking-widest">{active}</span>
      </div>
    )
  }

  return (
    <div className={`${containerCls} h-full`}>
      {/* header: tabs + instance switcher + dock/collapse controls */}
      <div className="flex items-center gap-1 px-2 py-1 border-b border-zinc-200 bg-white">
        {available.map(t => (
          <button key={t} onClick={() => useWorkspaceUiStore.getState().setActiveTab(t)}
            className={`px-2 py-1 text-[10px] font-bold uppercase tracking-widest rounded ${active === t ? 'bg-zinc-100 text-zinc-900' : 'text-zinc-400 hover:text-zinc-600'}`}>
            {t}{t === 'validation' && issues.length > 0 ? ` ${issues.length}` : ''}{t === 'validation' && issues.length === 0 ? ' ✓' : ''}
          </button>
        ))}
        <div className="ml-auto flex items-center gap-2">
          <InstanceSwitcher count={instanceCount} index={currentInstance}
            onChange={(i) => useRunStore.getState().setCurrentInstance(fileKey, i)} />
          <button onClick={() => ui.setDockSide(isRight ? 'bottom' : 'right')} className="text-zinc-400 hover:text-zinc-900" aria-label="Flip dock side">
            {isRight ? <PanelBottom size={14} /> : <PanelRight size={14} />}
          </button>
          <button onClick={ui.togglePanel} className="text-zinc-400 hover:text-zinc-900" aria-label="Collapse panel">
            {isRight ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
          </button>
        </div>
      </div>

      {error && (
        <div className="px-3 py-1.5 text-[11px] text-red-600 bg-red-50 border-b border-red-100">{error}</div>
      )}

      <div className="flex-1 min-h-0 overflow-auto">
        {active === 'output' && <OutputTab fileKey={fileKey} view={view === 'none' ? 'agent' : view} />}
        {active === 'validation' && <ValidationPanel issues={issues} onSelect={onSelectIssueNode} />}
        {active === 'history' && <HistoryPane entityType={type} slug={slug} onClose={ui.togglePanel} />}
      </div>
    </div>
  )
}
```

Note: resize handle is added in C4 (it depends on layout placement in `page.tsx`). For now the panel uses the persisted `panelSize` as a fixed size.

- [ ] **Step 2: Manual verify** — defer to C4 (DockPanel isn't mounted until then). Commit.

```bash
git add components/workspace/DockPanel.tsx
git commit -m "feat: DockPanel shell — tabs, dock flip, collapse, error banner"
```

---

### Task C4: Mount `DockPanel` in `page.tsx` with a resize divider

**Files:**
- Modify: `app/workspace/page.tsx`

**Interfaces:**
- Consumes: `DockPanel` (C3), `useWorkspaceUiStore` (A4). Needs chain validation issues + an issue→select callback for the Validation tab in YAML view; in graph view, selection feeds back into `ChainEditor` (handled in D-phase via the selection store; for now pass `() => {}` and the chain issues computed in `page.tsx`).

The panel docks bottom or right around the editor area. Use `react-resizable-panels` `Group`/`Panel`/`Separator` (already imported) so the divider is draggable; persist size on drag-stop into `useWorkspaceUiStore.setPanelSize`.

- [ ] **Step 1: Compute the view + issues at page level.**
```ts
  const view: 'graph' | 'yaml' | 'agent' | 'none' =
    type === 'chain' ? (chainView === 'graph' && parsedChain ? 'graph' : 'yaml')
    : type === 'agent' ? 'agent' : 'none'
```
For YAML/agent/none views, chain issues come from `parsedChain` when available:
```ts
  const dockIssues = useMemo(() => {
    if (type !== 'chain' || !parsedChain) return []
    // validateChain needs agents+chains; reuse editorAgents/editorChains already fetched
    return validateChain(parsedChain, editorAgents, editorChains).issues
  }, [type, parsedChain, editorAgents, editorChains])
```
Add `import { validateChain } from '@/lib/chainGraph'`.
(In **graph** view, `ChainEditor` computes its own issues and renders nothing at the bottom; the panel's Validation tab uses `dockIssues` from the same `parsedChain`, which matches the editor's initial graph. Live-edited issues in graph view are a known limitation tracked in §"Out of scope follow-ups" below — graph view's authoritative issues stay inside the editor's canvas borders/badges.)

- [ ] **Step 2: Wrap the editor area + panel in a resizable group keyed off dock side.**
Replace the single editor `<div className="h-full flex flex-col">…</div>` (from B3 Step 4) with:
```tsx
          <Group orientation={useWorkspaceUiStore.getState().dockSide === 'right' ? 'horizontal' : 'vertical'}>
            <Panel minSize={30}>
              <div className="h-full flex flex-col">
                {/* existing chain Graph/YAML toggle + ChainEditor/FileEditor switch */}
              </div>
            </Panel>
            <Separator className="bg-zinc-100 hover:bg-zinc-200 transition-colors data-[resize-handle-state=drag]:bg-zinc-300" />
            <Panel defaultSize="30%" minSize={10} onResize={() => { /* size persisted via DockPanel controls */ }}>
              <DockPanel type={type} slug={slug} view={view} issues={dockIssues} onSelectIssueNode={() => {}} />
            </Panel>
          </Group>
```
Add `import DockPanel from '@/components/workspace/DockPanel'` and `import { useWorkspaceUiStore } from '@/hooks/store/useWorkspaceUiStore'`. To make the group re-render on dock-side flip, read the value reactively:
```ts
  const dockSide = useWorkspaceUiStore(s => s.dockSide)
```
and use `orientation={dockSide === 'right' ? 'horizontal' : 'vertical'}`.

- [ ] **Step 3: Manual verify**

Run: `npm run dev`.
1. **Agent:** Run → Output tab shows the synthesized node's streamed output; History tab lists past runs; no Validation tab.
2. **Chain Graph:** Run → graph dots animate; click a node → Output tab shows that node; Validation tab shows issue count; flip dock to right (button) → panel moves to the right edge; collapse → strip with reopen affordance.
3. **Parallel:** set Parallel = 3 (toolbar), Run → instance switcher `‹ 1/3 ›` appears in the panel header; stepping it re-renders the Output tab per instance.
4. **Run-level error:** open a chain with a validation error and Run → red banner in panel + auto-switch to Validation tab (a3).

- [ ] **Step 4: Commit**

```bash
git add app/workspace/page.tsx
git commit -m "feat: mount DockPanel with resizable divider; compute view+issues"
```

---

### Task C5: Persist panel size on divider drag

**Files:**
- Modify: `app/workspace/page.tsx`

`react-resizable-panels` reports sizes in percentages, which is exactly how `useWorkspaceUiStore.panelSize` is already defined (Task A4: percent, clamp 10–80) and how `DockPanel` already behaves (Task C3: size owned by the parent `Panel`, no inline `sizeStyle`). This task only wires the parent `Panel` to read that value and persist it on drag.

- [ ] **Step 1: Drive `Panel` size from the store + persist on resize** in `page.tsx`:
```tsx
            <Panel defaultSize={`${panelSize}%`} minSize={10}
              onResize={(size) => useWorkspaceUiStore.getState().setPanelSize(typeof size === 'number' ? size : parseFloat(size))}>
              <DockPanel … />
            </Panel>
```
with `const panelSize = useWorkspaceUiStore(s => s.panelSize)`.

- [ ] **Step 2: Manual verify** — drag the divider, reload the page; panel restores to the dragged size (persisted). Toggle dock side; size persists across orientation.

- [ ] **Step 3: Commit**

```bash
git add app/workspace/page.tsx
git commit -m "feat: persist DockPanel size across reload/dock-flip"
```

---

### Task C6: History version-diff (decision a1)

**Files:**
- Modify: `components/workspace/HistoryPane.tsx`

Add a side-by-side diff between two selected versions on the Versions tab, using `diff-match-patch` (already a dependency) for line-level highlighting.

- [ ] **Step 1: Add version-select + diff state.** In `HistoryPane`, add:
```ts
  const [diffPair, setDiffPair] = useState<[number, number] | null>(null)
  const [diffText, setDiffText] = useState<{ a: string; b: string } | null>(null)
```
Add a checkbox per version row that fills `diffPair` (max two). When two are chosen, fetch both contents and store in `diffText`:
```ts
  useEffect(() => {
    if (!diffPair) { setDiffText(null); return }
    const [va, vb] = diffPair
    Promise.all([
      fetch(`/api/workspace/${entityType}/${slug}/versions?version=${va}`).then(r => r.json()),
      fetch(`/api/workspace/${entityType}/${slug}/versions?version=${vb}`).then(r => r.json()),
    ]).then(([a, b]) => setDiffText({ a: a.content, b: b.content })).catch(() => setDiffText(null))
  }, [diffPair, entityType, slug])
```

- [ ] **Step 2: Render a diff view** above the version list when `diffText` is set, using `diff-match-patch`:
```tsx
import { diff_match_patch } from 'diff-match-patch'
// …
{diffText && (() => {
  const dmp = new diff_match_patch()
  const d = dmp.diff_main(diffText.a, diffText.b)
  dmp.diff_cleanupSemantic(d)
  return (
    <div className="m-2 p-2 bg-white border border-zinc-200 rounded text-[11px] whitespace-pre-wrap font-mono">
      {d.map(([op, text], i) => (
        <span key={i} className={op === 1 ? 'bg-green-100' : op === -1 ? 'bg-red-100 line-through' : ''}>{text}</span>
      ))}
    </div>
  )
})()}
```

- [ ] **Step 3: Manual verify** — open History → Versions, check two versions; a side-by-side (inline) colorized diff renders. Unchecking clears it.

- [ ] **Step 4: Commit**

```bash
git add components/workspace/HistoryPane.tsx
git commit -m "feat: side-by-side version diff in History (a1)"
```

---

## Phase D — Chrome collapse, one-line header, instance switcher, Interface popover

### Task D1: One-line header in `page.tsx`

**Files:**
- Modify: `app/workspace/page.tsx`, `components/editor/ChainEditor.tsx`

Collapse the page toolbar + the Graph/YAML toggle row + ChainEditor's seed/run/undo bar into a single header line (design §1). Seed prompt becomes a single-line field with a click-to-expand popover (a5). Move undo/redo into the canvas area is out-of-scope for the header — keep undo/redo keyboard shortcuts (already global in `ChainEditor`) and drop the visible Undo/Redo buttons from the editor bar (they remain reachable via Ctrl/Cmd+Z/Y).

**Interfaces:**
- Consumes: `useRunStore` (seed/parallel/run), `useWorkspaceUiStore` (panel toggle).

- [ ] **Step 1: Build the one-line header** replacing the existing toolbar (`page.tsx:321-385`) and the Graph/YAML toggle row (`:398-416`). The header renders: title · (chains) Graph/YAML · seed (single-line + expand) · Parallel · Run · autosave · panel toggle. Non-runnable views render title only.
```tsx
      <header className="px-4 py-2 border-b border-zinc-100 flex items-center gap-3 bg-white/80 backdrop-blur-sm">
        <div className="h-6 w-1 bg-zinc-900 rounded-full" />
        <h1 className="text-sm font-bold text-zinc-900 capitalize">{slug.replace(/-/g, ' ')}</h1>
        {type === 'chain' && (
          <div className="flex items-center gap-1">
            <button onClick={() => setChainView('graph')} className={`px-2 py-1 text-xs rounded-md border ${chainView === 'graph' ? 'bg-zinc-900 text-white border-zinc-900' : 'bg-white text-zinc-500 border-zinc-200'}`}>Graph</button>
            <button onClick={() => setChainView('yaml')} className={`px-2 py-1 text-xs rounded-md border ${chainView === 'yaml' ? 'bg-zinc-900 text-white border-zinc-900' : 'bg-white text-zinc-500 border-zinc-200'}`}>YAML</button>
          </div>
        )}
        {(type === 'agent' || type === 'chain') && (
          <>
            <SeedField value={seedPrompt} onChange={setSeedPrompt} />
            <div className="flex items-center gap-1.5">
              <label className="text-[10px] font-bold text-zinc-400 uppercase tracking-widest">Parallel</label>
              <input type="number" min={1} max={10} value={parallelCount}
                onChange={(e) => setParallelCount(parseInt(e.target.value) || 1)}
                className="w-12 px-2 py-1 text-xs border border-zinc-200 rounded" />
            </div>
            <button onClick={handleRun} disabled={loading || running}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-zinc-900 text-white text-xs font-medium rounded-md hover:bg-zinc-800 disabled:opacity-50">
              <Play size={12} className="fill-current" />{running ? 'Running…' : 'Run'}
            </button>
            <span className="text-[10px] font-bold text-zinc-400 uppercase tracking-widest">{status}</span>
          </>
        )}
        {type === 'chain' && <InterfacePopoverMount />}
        <button onClick={() => useWorkspaceUiStore.getState().togglePanel()} className="ml-auto p-1.5 rounded-md border border-zinc-200 text-zinc-500 hover:bg-zinc-50" aria-label="Toggle panel">
          <PanelBottom size={16} />
        </button>
      </header>
```
(`InterfacePopoverMount` is added in Task D5; until then omit that line. `SeedField` defined next.)

- [ ] **Step 2: Add the `SeedField` component** (single-line + click-to-expand popover, a5). Add at the bottom of `page.tsx` (module scope) or as a small file `components/workspace/SeedField.tsx`:
```tsx
'use client'
import React, { useState } from 'react'
function SeedField({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const [open, setOpen] = useState(false)
  return (
    <div className="relative flex-1 min-w-[120px] max-w-[420px]">
      <input value={value} onChange={e => onChange(e.target.value)} onFocus={() => setOpen(false)}
        placeholder="Seed prompt ({input})…" className="w-full text-xs border border-zinc-200 rounded px-2 py-1" />
      <button onClick={() => setOpen(o => !o)} className="absolute right-1 top-1/2 -translate-y-1/2 text-[10px] text-zinc-400 hover:text-zinc-700">⤢</button>
      {open && (
        <div className="absolute z-30 mt-1 w-[420px] bg-white border border-zinc-200 rounded-md shadow-lg p-2">
          <textarea value={value} onChange={e => onChange(e.target.value)} rows={6} autoFocus
            className="w-full text-xs border border-zinc-100 rounded p-2 resize-none" placeholder="Seed prompt ({input})…" />
        </div>
      )}
    </div>
  )
}
```
Create as `components/workspace/SeedField.tsx` and import it (cleaner than module scope). Keep `seedPrompt`/`setSeedPrompt` page state; the existing effect already pushes it into the run store.

- [ ] **Step 3: Strip ChainEditor's top bar.** In `ChainEditor.tsx`, remove the entire header `<div className="px-4 py-2 border-b …">…</div>` (`:202-232`: seed input, Run, Undo, Redo, autosave). Keep the `conflict` file-watch banner; render it as the first child so it sits directly under the page header. The autosave `status` and seed now live in the page header. (ChainEditor still owns autosave via `useAutoSave`; the page header's `status` comes from the page's own `useAutoSave`. Confirm both editors don't double-save: graph view uses ChainEditor's `setContent`; the page's `useAutoSave` is for the YAML/FileEditor path. They key the same file — verify only the active view writes. If both fire, gate the page's `setContent` to non-graph views.)

- [ ] **Step 4: Manual verify** — one header line only; no stacked toolbars; seed expand popover works; Run + Parallel + autosave label present; Graph/YAML toggle inline; non-runnable views (skill/template/context) show title + panel toggle only.

- [ ] **Step 5: Commit**

```bash
git add app/workspace/page.tsx components/workspace/SeedField.tsx components/editor/ChainEditor.tsx
git commit -m "feat: one-line workspace header with expandable seed field"
```

---

### Task D2: Collapsible sidebar

**Files:**
- Modify: `app/workspace/layout.tsx`, `components/workspace/Sidebar.tsx`

**Interfaces:**
- Consumes: `useWorkspaceUiStore.sidebarCollapsed` / `toggleSidebar` (A4).

- [ ] **Step 1: Collapse the layout panel.** In `layout.tsx`, read the store and swap the sidebar `Panel` for a thin rail when collapsed:
```tsx
'use client'
import Sidebar from '@/components/workspace/Sidebar'
import { Suspense } from 'react'
import { Group, Panel, Separator } from 'react-resizable-panels'
import { useWorkspaceUiStore } from '@/hooks/store/useWorkspaceUiStore'
import { PanelLeftOpen } from 'lucide-react'

export default function WorkspaceLayout({ children }: { children: React.ReactNode }) {
  const collapsed = useWorkspaceUiStore(s => s.sidebarCollapsed)
  return (
    <div className="h-[calc(100vh-3.5rem)] overflow-hidden">
      <Group orientation="horizontal">
        {collapsed ? (
          <div className="w-9 h-full border-r border-zinc-200 bg-white flex flex-col items-center py-3">
            <button onClick={() => useWorkspaceUiStore.getState().toggleSidebar()} className="text-zinc-500 hover:text-zinc-900" aria-label="Open sidebar">
              <PanelLeftOpen size={18} />
            </button>
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

- [ ] **Step 2: Add a collapse button inside `Sidebar`.** In the category nav column (`Sidebar.tsx:281-302`), add a collapse button at the bottom:
```tsx
        <button onClick={() => useWorkspaceUiStore.getState().toggleSidebar()}
          className="mt-auto p-2.5 rounded-lg text-zinc-400 hover:text-zinc-600 hover:bg-zinc-50" title="Collapse sidebar" aria-label="Collapse sidebar">
          <PanelLeftClose size={20} />
        </button>
```
Add imports: `import { useWorkspaceUiStore } from '@/hooks/store/useWorkspaceUiStore'` and `PanelLeftClose` from `lucide-react`.

- [ ] **Step 3: Manual verify** — collapse → thin rail with reopen icon; reopen restores width; state survives reload (persisted).

- [ ] **Step 4: Commit**

```bash
git add app/workspace/layout.tsx components/workspace/Sidebar.tsx
git commit -m "feat: collapsible workspace sidebar (persisted)"
```

---

### Task D3: Collapsible node palette

**Files:**
- Modify: `components/editor/NodePalette.tsx`, `components/editor/ChainEditor.tsx`

**Interfaces:**
- Consumes: `useWorkspaceUiStore.paletteCollapsed` / `togglePalette` (A4).

- [ ] **Step 1: Add collapse to `NodePalette`.** At the top of the returned `<div>`:
```tsx
import { useWorkspaceUiStore } from '@/hooks/store/useWorkspaceUiStore'
import { PanelLeftClose, PanelLeftOpen } from 'lucide-react'
// inside component:
  const collapsed = useWorkspaceUiStore(s => s.paletteCollapsed)
  if (collapsed) {
    return (
      <div className="w-9 shrink-0 border-r border-zinc-100 bg-white flex flex-col items-center py-2">
        <button onClick={() => useWorkspaceUiStore.getState().togglePalette()} className="text-zinc-400 hover:text-zinc-700" aria-label="Open palette"><PanelLeftOpen size={16} /></button>
      </div>
    )
  }
```
And add a collapse button into the expanded palette header (above the search input):
```tsx
      <div className="flex justify-end mb-1">
        <button onClick={() => useWorkspaceUiStore.getState().togglePalette()} className="text-zinc-300 hover:text-zinc-600" aria-label="Collapse palette"><PanelLeftClose size={14} /></button>
      </div>
```

- [ ] **Step 2: Manual verify** — in Graph view, collapse palette → thin rail; reopen restores; persists across reload.

- [ ] **Step 3: Commit**

```bash
git add components/editor/NodePalette.tsx
git commit -m "feat: collapsible node palette (persisted)"
```

---

### Task D4: Canvas instance-switcher overlay

**Files:**
- Modify: `components/editor/ChainCanvas.tsx`, `components/editor/ChainEditor.tsx`

Show the instance switcher as an overlay on the graph canvas (design §6), so the user can switch which instance drives graph highlighting without going to the panel header.

**Interfaces:**
- Consumes: `useRunStore` (instanceCount, currentInstance, setCurrentInstance), `InstanceSwitcher` (C1). `ChainCanvas` gains props `instanceCount: number; currentInstance: number; onInstance: (i: number) => void`.

- [ ] **Step 1: Add props + overlay to `ChainCanvas`.** Extend `ChainCanvasProps`:
```ts
  instanceCount: number
  currentInstance: number
  onInstance: (i: number) => void
```
Render an absolutely-positioned overlay inside the canvas wrapper `<div className="w-full h-full bg-zinc-50">` (before `<ReactFlowProvider>`):
```tsx
      {props.instanceCount > 1 && (
        <div className="absolute top-2 right-2 z-10 bg-white/90 border border-zinc-200 rounded-md px-2 py-1 shadow-sm">
          <InstanceSwitcher count={props.instanceCount} index={props.currentInstance} onChange={props.onInstance} />
        </div>
      )}
```
Make the wrapper `relative`: `className="w-full h-full bg-zinc-50 relative"`. Import `InstanceSwitcher`.

- [ ] **Step 2: Pass the props from `ChainEditor`.**
```tsx
          <ChainCanvas
            …
            instanceCount={file?.instanceCount ?? 0}
            currentInstance={currentInstance}
            onInstance={(i) => useRunStore.getState().setCurrentInstance(fileKey, i)}
          />
```

- [ ] **Step 3: Manual verify** — Parallel = 3, Run; the `‹ 1/3 ›` overlay appears top-right of the canvas; stepping it changes which instance's status dots + node outputs show (graph highlighting follows the selected instance).

- [ ] **Step 4: Commit**

```bash
git add components/editor/ChainCanvas.tsx components/editor/ChainEditor.tsx
git commit -m "feat: canvas instance-switcher overlay"
```

---

### Task D5: Interface authoring → header popover

**Files:**
- Create: `components/editor/InterfacePopover.tsx`
- Modify: `app/workspace/page.tsx` (mount in header), `components/editor/ChainEditor.tsx` (expose iface + onChange)

The chain public-interface authoring (`InterfacePanel`, was a bottom strip) moves into a header "Interface ▾" popover (design Dependencies §C2.4). `InterfacePanel`'s body is reused unchanged; only its container moves.

**Problem:** `iface` state lives inside `ChainEditor`, but the header lives in `page.tsx`. Lift `iface` to a small shared store-free bridge: since only the graph view authors the interface, render the popover **inside `ChainEditor`'s** subtree (as an absolutely-positioned element anchored under the header), not in `page.tsx`. This avoids lifting `iface`.

- [ ] **Step 1: Create `InterfacePopover`** wrapping `InterfacePanel`:
```tsx
'use client'
import React, { useState } from 'react'
import InterfacePanel from './InterfacePanel'
import type { ChainNode, ChainPort } from '@/lib/types'

export default function InterfacePopover({ nodes, inputs, outputs, onChange }: {
  nodes: ChainNode[]; inputs: ChainPort[]; outputs: ChainPort[]
  onChange: (iface: { inputs: ChainPort[]; outputs: ChainPort[] }) => void
}) {
  const [open, setOpen] = useState(false)
  const count = inputs.length + outputs.length
  return (
    <div className="relative">
      <button onClick={() => setOpen(o => !o)} className="px-2 py-1 text-xs rounded-md border border-zinc-200 text-zinc-600 hover:bg-zinc-50">
        Interface{count ? ` (${count})` : ''} ▾
      </button>
      {open && (
        <div className="absolute z-30 mt-1 w-[460px] bg-white border border-zinc-200 rounded-md shadow-lg">
          <InterfacePanel nodes={nodes} inputs={inputs} outputs={outputs} onChange={onChange} />
        </div>
      )}
    </div>
  )
}
```

- [ ] **Step 2: Render the popover in `ChainEditor`** as the first row under the file-watch banner (it can sit in a thin bar above the canvas split, right-aligned):
```tsx
      <div className="px-4 py-1 border-b border-zinc-100 flex items-center justify-end bg-white">
        <InterfacePopover nodes={nodes} inputs={iface.inputs} outputs={iface.outputs} onChange={setIface} />
      </div>
```
Import `InterfacePopover`; remove the old bottom `InterfacePanel` import (already removed in B1 Step 5 if done; verify).

- [ ] **Step 3: Manual verify** — in Graph view, an "Interface ▾" button appears; clicking opens the inputs/outputs authoring; edits persist (serialized into the chain via the existing `iface` → `setContent` effect). No bottom Interface strip.

- [ ] **Step 4: Commit**

```bash
git add components/editor/InterfacePopover.tsx components/editor/ChainEditor.tsx
git commit -m "feat: chain interface authoring as header popover"
```

---

### Task D6: File-watch banner survives the header refactor

**Files:**
- Modify: `components/editor/ChainEditor.tsx` (verify only)

**Interfaces:** none.

- [ ] **Step 1: Confirm placement.** The `conflict` banner (`This chain changed on disk…`) must render directly under the page header, above the Interface bar/canvas. Verify it is the first element in `ChainEditor`'s return after the header was stripped (B1/D1). If not, move it to the top.

- [ ] **Step 2: Manual verify** — edit the chain `.md` file on disk externally; the adopt/conflict banner appears under the header (not lost); "Reload from disk" / "Keep my version" work.

- [ ] **Step 3: Commit** (if any change)

```bash
git add components/editor/ChainEditor.tsx
git commit -m "fix: keep file-watch conflict banner under one-line header"
```

---

## Phase E — Cleanup & verification

### Task E1: Delete `NodePreview`; remove dead code; full verification

**Files:**
- Delete: `components/editor/NodePreview.tsx`
- Modify: any remaining importers

- [ ] **Step 1: Delete the file + remove its import** from `ChainEditor.tsx` (should already be removed in B1; this confirms). Confirm no other importer:
Run: `npx grep -rn "NodePreview" --include=*.tsx --include=*.ts .` (or use the editor search). Expected: no matches outside the deleted file.

- [ ] **Step 2: Remove any remaining dead symbols.** Search and confirm empty:
  - `grep -rn "AgentStreamOutput" app/workspace/page.tsx` → empty (still used by `HistoryPane` — that's fine; only `page.tsx` should be clean).
  - `grep -rn "runsByFile\|runSingleInstance\|isOutputVisible\|isHistoryVisible" app/workspace/page.tsx` → empty.
  - `grep -rn "registerFlush" .` → empty (seam never existed post-design; confirm).

- [ ] **Step 3: Typecheck + lint + full test run.**
Run: `npx tsc --noEmit`
Expected: no errors.
Run: `npm run lint`
Expected: no new errors.
Run: `npm run test:run`
Expected: all `tests/**` pass (including the four new ones: run-model, run-store, selection-store, tab-clamp).

- [ ] **Step 4: Full manual smoke (the design's per-view matrix).**
Run: `npm run dev` and verify each row of the design's Per-view table:
  - **Chain·Graph:** one header line; Run; click node → Output; Validation count; instance switcher on canvas + panel; collapse sidebar/palette/panel each leave a reopen rail.
  - **Chain·YAML:** Output stacks all nodes; Validation present; instance switcher in panel header.
  - **Agent:** Output = synthesized node; no Validation tab; instance switcher in panel header.
  - **Skill/Template/Context:** title-only header; panel shows History only (Output/Validation hidden).
  - **a4 boundary:** start a run, switch files/tabs/dock — run continues; F5 reload ends live stream but the run shows up in History.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "chore: delete NodePreview; remove dead run/console code; verify"
```

---

## Out-of-scope follow-ups (noted, not implemented here)

- **Live-edited graph-view validation in the panel:** in Graph view the panel's Validation tab uses `parsedChain` issues (initial graph); the editor's canvas badges remain the authoritative live view. Unifying these means lifting graph topology to a store — explicitly out of scope (design "Out of scope").
- **Live reconnect to an in-progress run after F5** — out of scope (design).
- **Undo/Redo buttons** were dropped from the visible UI in D1 (keyboard shortcuts retained). Re-add as a canvas overlay if desired — not required by the design.

## Self-review notes (coverage map)

- §1 one-line header → D1; seed expand (a5) → D1 `SeedField`.
- §2 single run engine / fan-out / partial-run-single-instance → A2, B1, B3.
- §3 collapsible sidebar → D2; §4 collapsible palette → D3.
- §5 merged panel (Output/Validation/History, dock/collapse/resize, scrollable) → C2–C5; version diff (a1) → C6.
- §6 instance switcher (canvas + panel) → C1, C3, D4.
- §7 three stores (run/selection/ui), 2D shape, tab clamp, no run-state persistence → A1–A4, B1.
- §8 AgentNode inline-output removal → B2.
- Per-view matrix + edge cases (a1/a3/a4/a5, parallel divergence, skipped, new-run-reset, streaming) → C3 (error banner/auto-switch), C4 (parallel/instance), B1 (reset), A1/A2 (skipped + streaming via existing `applyRunEvent`).
- Dependencies §C2.4 Interface popover → D5; §C2.8 file-watch banner → D6.
