# Phase 5 — Group B (Medium) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Land the two enabling refactors (§1.1 inline-chain run, §1.2 editor reducer) and the features that ride on them — partial run (§2.1), per-node preview (§2.2), undo/redo (§2.3), and drag-into-zone membership (§2.6).

**Architecture:** Pure logic (`resolveRunChain`, `applyEditorAction`, `withHistory`, `upstreamSubgraph`, `zoneAtPoint`) lives in `lib/*` and is unit-tested. `ChainEditor` migrates from scattered `useState` to a single `useReducer` wrapped in a history meta-reducer; runs go through an inline-graph endpoint so the canvas is the source of truth (no flush-before-run). The executor is unchanged — partial run is graph truncation + the inline run.

**Tech Stack:** Next.js 16.2.2 (app router), React 19, `@xyflow/react`, `tsx` tests.

**Design source:** `docs/maestro/plans/2026-06-29-phase5-backlog-design.md` (Group B). **Assumes Group A is merged** (`selectedIds`, `clipboard`, `copySubgraph`/`pasteSubgraph`, `moveMany`, agent drawer already exist).

## Global Constraints

- **Next.js 16 — consult the project skill.** Before editing the run route (Task 1), read `.agents/skills/nextjs16.md` (authoritative), then `node_modules/next/dist/docs/` for gaps. Notes: `await req.json()` is fine (request methods aren't the async ones — only `params`/`searchParams`/`cookies()`/`headers()` are); the `POST` streaming `Response` (SSE) is unchanged from the existing route; `GET` handlers are no longer cached by default.
- **React Flow v12 (@xyflow/react) — consult the project skill.** Read `.agents/skills/xyflow12.md` before the selection/drag work. Keep `onSelectionChange`/`onSelectionDragStop` handlers stable; **never mutate** RF nodes (the reducer spreads); use `node.position` (the inline value), not `node.measured.*`, for drag-stop persistence.
- **Tests are framework-free scripts.** `import assert from 'node:assert'`, run with `npx tsx tests/<file>.test.ts`, end with `console.log('✅ <name> tests passed')`.
- **React components are not unit-tested** — UI tasks end with manual verification against `npm run dev`, then a commit.
- **One commit per task**; conventional messages.
- **Reducer scope rule:** the editor reducer owns `{ nodes, edges, selectedIds, clipboard }` only. `runState`/`seedPrompt`/`running` stay as `useState` and never enter undo history.
- **History granularity rule:** `setSelection`, `copy`, and `setGraph` are **non-historic** (replace present without pushing); every other mutation pushes one entry. A settled drag = one entry.

---

## File Structure

**Create:**
- `lib/resolveRunChain.ts` + `tests/resolve-run-chain.test.ts` — §1.1 pure run-target resolution.
- `lib/editorReducer.ts` + `tests/editor-reducer.test.ts` — §1.2 pure editor reducer.
- `lib/history.ts` + `tests/history.test.ts` — §2.3 undo/redo meta-reducer.
- `lib/partialRun.ts` + `tests/partial-run.test.ts` — §2.1 upstream-subgraph truncation.

**Modify:**
- `app/api/run/route.ts` — use `resolveRunChain`; accept inline `chain`.
- `components/editor/ChainEditor.tsx` — inline run; `useReducer` + history; `runUpTo`; per-node run; drag-into-zone.
- `lib/zoneFrames.ts` — add `zoneAtPoint`.
- `tests/zone-frames.test.ts` — add `zoneAtPoint` cases.
- `components/editor/nodeData.ts` — add `onRunFromHere?`.
- `components/editor/nodes/AgentNode.tsx` (and other node chrome) — "▶ from here" button.

---

## Task 1: Inline-chain run (§1.1)

Extract run-target resolution into a pure function and let `/api/run` accept an inline graph, so a run never depends on a prior disk write.

**Files:**
- Create: `lib/resolveRunChain.ts`
- Test: `tests/resolve-run-chain.test.ts`
- Modify: `app/api/run/route.ts`
- Modify: `components/editor/ChainEditor.tsx`

**Interfaces:**
- Consumes: `ChainDef`, `AgentDef` from `lib/types.ts`.
- Produces:
  - `interface RunChainBody { chainName?: string; agentName?: string; chain?: { name?: string; description?: string; nodes: ChainNode[]; edges: ChainEdge[] }; slug?: string }`
  - `type ResolvedRun = { chain: ChainDef; title: string; kind: 'inline' | 'chain' | 'agent' } | { error: string; status: number }`
  - `resolveRunChain(body: RunChainBody, ws: { agents: AgentDef[]; chains: ChainDef[] }): ResolvedRun`

- [ ] **Step 1: Write the failing tests.** New file `tests/resolve-run-chain.test.ts`:

```ts
import assert from 'node:assert'
import { resolveRunChain } from '../lib/resolveRunChain'
import { AgentDef, ChainDef } from '../lib/types'

const chains: ChainDef[] = [{
  slug: 'triage', name: 'Triage', description: '', filePath: '/w/chains/triage.md',
  nodes: [{ id: 'seed', kind: 'seed' }], edges: [],
}]
const agents = [{ slug: 'writer', name: 'Writer', systemPrompt: 'hi' } as AgentDef]

// inline graph is used verbatim, kind 'inline', no filePath
const inline = resolveRunChain({ chain: { name: 'Live', nodes: [{ id: 'seed', kind: 'seed' }], edges: [] }, slug: 'triage' }, { agents, chains })
assert.ok('chain' in inline)
if ('chain' in inline) {
  assert.strictEqual(inline.kind, 'inline')
  assert.strictEqual(inline.chain.filePath, '')
  assert.strictEqual(inline.chain.nodes.length, 1)
}

// chainName resolves from the workspace by name or slug
const byName = resolveRunChain({ chainName: 'Triage' }, { agents, chains })
assert.ok('chain' in byName && byName.kind === 'chain' && byName.chain.slug === 'triage')

// unknown chainName -> error 404
const missing = resolveRunChain({ chainName: 'nope' }, { agents, chains })
assert.ok('error' in missing && missing.status === 404)

// agentName synthesizes a seed -> agent chain
const ag = resolveRunChain({ agentName: 'writer' }, { agents, chains })
assert.ok('chain' in ag && ag.kind === 'agent')
if ('chain' in ag) {
  assert.strictEqual(ag.chain.nodes.length, 2)
  assert.strictEqual(ag.chain.edges[0].toNode, 'writer')
}

// nothing -> error 400
const none = resolveRunChain({}, { agents, chains })
assert.ok('error' in none && none.status === 400)

console.log('✅ resolve-run-chain tests passed')
```

- [ ] **Step 2: Run to verify failure**

Run: `npx tsx tests/resolve-run-chain.test.ts`
Expected: FAIL — cannot find module `../lib/resolveRunChain`.

- [ ] **Step 3: Implement.** New file `lib/resolveRunChain.ts`:

```ts
import { AgentDef, ChainDef, ChainNode, ChainEdge } from './types'

export interface RunChainBody {
  chainName?: string
  agentName?: string
  chain?: { name?: string; description?: string; nodes: ChainNode[]; edges: ChainEdge[] }
  slug?: string
}

export type ResolvedRun =
  | { chain: ChainDef; title: string; kind: 'inline' | 'chain' | 'agent' }
  | { error: string; status: number }

export function resolveRunChain(
  body: RunChainBody,
  ws: { agents: AgentDef[]; chains: ChainDef[] },
): ResolvedRun {
  if (body.chain) {
    const name = body.chain.name || 'Inline chain'
    return {
      kind: 'inline',
      title: name,
      chain: {
        slug: body.slug || 'inline', name, description: body.chain.description || '',
        nodes: body.chain.nodes, edges: body.chain.edges, filePath: '',
      },
    }
  }
  if (body.chainName) {
    const found = ws.chains.find(c => c.name === body.chainName) || ws.chains.find(c => c.slug === body.chainName)
    if (!found) return { error: 'Chain not found', status: 404 }
    return { kind: 'chain', title: found.name, chain: found }
  }
  if (body.agentName) {
    const agent = ws.agents.find(a => a.name === body.agentName) || ws.agents.find(a => a.slug === body.agentName)
    if (!agent) return { error: 'Agent not found', status: 404 }
    return {
      kind: 'agent', title: agent.name,
      chain: {
        slug: agent.slug, name: agent.name, description: '', filePath: '',
        nodes: [{ id: 'seed', kind: 'seed' }, { id: agent.slug, kind: 'agent', agent: agent.slug }],
        edges: [{ fromNode: 'seed', fromSocket: 'output', toNode: agent.slug, toSocket: 'input' }],
      },
    }
  }
  return { error: 'No chain or agent specified', status: 400 }
}
```

- [ ] **Step 4: Run to verify pass**

Run: `npx tsx tests/resolve-run-chain.test.ts`
Expected: PASS — `✅ resolve-run-chain tests passed`.

- [ ] **Step 5: Rewire the route.** In `app/api/run/route.ts`, replace the chain-resolution block (the `let chain… if (chainName) … else if (agentName) … else …` section through the validation) with the helper call. Keep `snapshotVersion` driven by `kind`:

```ts
  const body = await req.json()
  const { seedPrompt, branchedFromRunId, branchedFromStep, branchOutputs } = body
  const { agents, skills, chains } = loadWorkspace()

  const resolved = resolveRunChain(body, { agents, chains })
  if ('error' in resolved) return new Response(resolved.error, { status: resolved.status })
  const { chain, title: runTitle, kind } = resolved

  let currentVersion = 0
  if (kind === 'chain' && chain.filePath) {
    let rawContent = ''
    try { rawContent = fs.readFileSync(chain.filePath, 'utf-8') } catch {}
    currentVersion = snapshotVersion('chain', chain.slug, rawContent)
  } else if (kind === 'agent') {
    const agent = agents.find(a => a.slug === chain.slug)
    if (agent) currentVersion = snapshotVersion('agent', agent.slug, agent.systemPrompt)
  }

  const validation = validateChain(chain, agents)
  if (!validation.valid) {
    return new Response(JSON.stringify({ error: 'Invalid chain', errors: validation.errors }), {
      status: 400, headers: { 'Content-Type': 'application/json' },
    })
  }
```

  Add the import at the top: `import { resolveRunChain } from '@/lib/resolveRunChain'`. The rest of the route (`runId`, `meta`, stream) is unchanged.

  > Next.js 16 note (`.agents/skills/nextjs16.md`): the route still returns a `ReadableStream` `Response` with `text/event-stream` headers exactly as before — body streaming is unaffected by the 16 breaking changes. Leave `await req.json()` as-is.

- [ ] **Step 6: Switch the editor to inline run.** In `components/editor/ChainEditor.tsx`, change the `run` callback so it posts the live graph instead of flushing then naming. Replace the `flush(...)` + `fetch` body with:

```ts
      const res = await fetch('/api/run', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chain: { name: meta.name, description: meta.description, nodes, edges },
          seedPrompt, type: 'chain', slug,
        }),
      })
```

  Remove `flush` from the destructure of `useAutoSave` if it is now unused, and from the `run` callback's dependency array. Autosave still persists via the existing serialize `useEffect`.

- [ ] **Step 7: Manual verification**

Run: `npm run dev`, open a chain in Graph mode:
- Edit a node, then immediately click **Run** (before the ~2s autosave fires). The run reflects your live edit (not the last-saved disk version).
- A normal run still streams per-node output as before.
- Running from the standard workspace toolbar (by `chainName`) still works (open a chain and use the top toolbar Run).

- [ ] **Step 8: Commit**

```bash
git add lib/resolveRunChain.ts tests/resolve-run-chain.test.ts app/api/run/route.ts components/editor/ChainEditor.tsx
git commit -m "feat: inline-chain run — /api/run accepts a live graph, editor drops flush-before-run"
```

---

## Task 2: Single editor reducer (§1.2)

Collapse the editor's `useState` cluster and Group A's selection/clipboard state into one pure reducer.

**Files:**
- Create: `lib/editorReducer.ts`
- Test: `tests/editor-reducer.test.ts`
- Modify: `components/editor/ChainEditor.tsx`

**Interfaces:**
- Consumes: `connectEdge`, `deleteNode as opDeleteNode`, `deleteEdge as opDeleteEdge`, `makeLoopZone`, `copySubgraph`, `pasteSubgraph`, `Subgraph` (all `lib/editorOps.ts`).
- Produces:
  - `interface EditorState { nodes: ChainNode[]; edges: ChainEdge[]; selectedIds: string[]; clipboard: Subgraph | null }`
  - `type EditorAction` (the union in Step 3)
  - `applyEditorAction(state: EditorState, action: EditorAction): EditorState`
  - `NON_HISTORIC: Set<string>` (`{'setSelection','copy','setGraph'}`)

- [ ] **Step 1: Write the failing tests.** New file `tests/editor-reducer.test.ts`:

```ts
import assert from 'node:assert'
import { applyEditorAction, EditorState } from '../lib/editorReducer'
import { ChainNode, ChainEdge } from '../lib/types'

const base: EditorState = {
  nodes: [{ id: 'a', kind: 'seed' }, { id: 'b', kind: 'agent', agent: 'x' }],
  edges: [{ fromNode: 'a', fromSocket: 'output', toNode: 'b', toSocket: 'input' }],
  selectedIds: [], clipboard: null,
}

// addNode appends, original state is untouched (purity)
const added = applyEditorAction(base, { type: 'addNode', node: { id: 'c', kind: 'gate' } })
assert.strictEqual(added.nodes.length, 3)
assert.strictEqual(base.nodes.length, 2)

// deleteNode removes incident edges and deselects
const sel = { ...base, selectedIds: ['b'] }
const del = applyEditorAction(sel, { type: 'deleteNode', id: 'b' })
assert.strictEqual(del.nodes.length, 1)
assert.strictEqual(del.edges.length, 0)
assert.deepStrictEqual(del.selectedIds, [])

// updateNode patches in place
const up = applyEditorAction(base, { type: 'updateNode', id: 'b', patch: { agent: 'y' } })
assert.strictEqual(up.nodes.find(n => n.id === 'b')!.agent, 'y')

// moveMany updates several positions
const mv = applyEditorAction(base, { type: 'moveMany', updates: [{ id: 'a', pos: [5, 5] }, { id: 'b', pos: [9, 9] }] })
assert.deepStrictEqual(mv.nodes.find(n => n.id === 'a')!.pos, [5, 5])

// copy then paste duplicates with fresh ids
const copied = applyEditorAction({ ...base, selectedIds: ['a', 'b'] }, { type: 'copy', ids: ['a', 'b'] })
assert.ok(copied.clipboard && copied.clipboard.nodes.length === 2)
const pasted = applyEditorAction(copied, { type: 'paste' })
assert.strictEqual(pasted.nodes.length, 4)
assert.strictEqual(pasted.selectedIds.length, 2)

console.log('✅ editor-reducer tests passed')
```

- [ ] **Step 2: Run to verify failure**

Run: `npx tsx tests/editor-reducer.test.ts`
Expected: FAIL — cannot find module `../lib/editorReducer`.

- [ ] **Step 3: Implement the reducer.** New file `lib/editorReducer.ts`:

```ts
import { ChainNode, ChainEdge } from './types'
import {
  connectEdge, deleteNode as opDeleteNode, deleteEdge as opDeleteEdge,
  makeLoopZone, copySubgraph, pasteSubgraph, Subgraph,
} from './editorOps'

export interface EditorState {
  nodes: ChainNode[]
  edges: ChainEdge[]
  selectedIds: string[]
  clipboard: Subgraph | null
}

export type EditorAction =
  | { type: 'setGraph'; nodes: ChainNode[]; edges: ChainEdge[] }
  | { type: 'addNode'; node: ChainNode }
  | { type: 'addLoopZone'; pos: [number, number] }
  | { type: 'connect'; edge: ChainEdge }
  | { type: 'deleteNode'; id: string }
  | { type: 'deleteEdge'; edge: ChainEdge }
  | { type: 'moveNode'; id: string; pos: [number, number] }
  | { type: 'moveMany'; updates: { id: string; pos: [number, number] }[] }
  | { type: 'updateNode'; id: string; patch: Partial<ChainNode> }
  | { type: 'setSelection'; ids: string[] }
  | { type: 'copy'; ids: string[] }
  | { type: 'paste' }

export const NON_HISTORIC = new Set<string>(['setSelection', 'copy', 'setGraph'])

export function applyEditorAction(state: EditorState, action: EditorAction): EditorState {
  switch (action.type) {
    case 'setGraph':
      return { ...state, nodes: action.nodes, edges: action.edges }
    case 'addNode':
      return { ...state, nodes: [...state.nodes, action.node] }
    case 'addLoopZone':
      return { ...state, nodes: [...state.nodes, ...makeLoopZone(state.nodes.map(n => n.id), action.pos)] }
    case 'connect':
      return { ...state, edges: connectEdge(state.edges, action.edge) }
    case 'deleteNode': {
      const { nodes, edges } = opDeleteNode(state.nodes, state.edges, action.id)
      return { ...state, nodes, edges, selectedIds: state.selectedIds.filter(x => x !== action.id) }
    }
    case 'deleteEdge':
      return { ...state, edges: opDeleteEdge(state.edges, action.edge) }
    case 'moveNode':
      return { ...state, nodes: state.nodes.map(n => n.id === action.id ? { ...n, pos: action.pos } : n) }
    case 'moveMany': {
      const m = new Map(action.updates.map(u => [u.id, u.pos]))
      return { ...state, nodes: state.nodes.map(n => m.has(n.id) ? { ...n, pos: m.get(n.id)! } : n) }
    }
    case 'updateNode':
      return { ...state, nodes: state.nodes.map(n => n.id === action.id ? { ...n, ...action.patch } : n) }
    case 'setSelection':
      return { ...state, selectedIds: action.ids }
    case 'copy':
      return { ...state, clipboard: copySubgraph(state.nodes, state.edges, action.ids) }
    case 'paste': {
      if (!state.clipboard) return state
      const { nodes, edges, newIds } = pasteSubgraph(state.clipboard, state.nodes.map(n => n.id), [40, 40])
      return { ...state, nodes: [...state.nodes, ...nodes], edges: [...state.edges, ...edges], selectedIds: newIds }
    }
    default:
      return state
  }
}
```

- [ ] **Step 4: Run to verify pass**

Run: `npx tsx tests/editor-reducer.test.ts`
Expected: PASS — `✅ editor-reducer tests passed`.

- [ ] **Step 5: Migrate `ChainEditor` to `useReducer`.** In `components/editor/ChainEditor.tsx`:

  Replace the Group-A state cluster (`useState` for `nodes`, `edges`, `selectedIds`, `clipboard`) with one reducer, seeded from `initialChain`:

```ts
  const [state, dispatch] = useReducer(applyEditorAction, undefined, () => ({
    nodes: seedPositions(initialChain.nodes, initialChain.edges),
    edges: initialChain.edges,
    selectedIds: [],
    clipboard: null,
  }))
  const { nodes, edges, selectedIds, clipboard } = state
  const primaryId = selectedIds[0] ?? null
```

  Rewrite each handler as a dispatch (delete the old `setNodes`/`setEdges`/`setSelectedIds` callbacks):

```ts
  const updateNode = useCallback((id: string, patch: Partial<ChainNode>) => dispatch({ type: 'updateNode', id, patch }), [])
  const moveNode = useCallback((id: string, pos: [number, number]) => dispatch({ type: 'moveNode', id, pos }), [])
  const moveMany = useCallback((updates: { id: string; pos: [number, number] }[]) => dispatch({ type: 'moveMany', updates }), [])
  const addNodeOfKind = useCallback((kind: ChainNodeKind) => dispatch({ type: 'addNode', node: { id: uniqueNodeId(kind, nodes.map(n => n.id)), kind, pos: [80, 80] } }), [nodes])
  const addLoopZone = useCallback(() => dispatch({ type: 'addLoopZone', pos: [120, 120] }), [])
  const connect = useCallback((edge: ChainEdge) => dispatch({ type: 'connect', edge }), [])
  const deleteNode = useCallback((id: string) => dispatch({ type: 'deleteNode', id }), [])
  const deleteEdge = useCallback((edge: ChainEdge) => dispatch({ type: 'deleteEdge', edge }), [])
  const setSelectedIds = useCallback((ids: string[]) => dispatch({ type: 'setSelection', ids }), [])
```

  Replace the Group-A copy/paste key handler body so it dispatches actions instead of calling ops directly:

```ts
      if (key === 'c' && selectedIds.length) dispatch({ type: 'copy', ids: selectedIds })
      else if (key === 'v') dispatch({ type: 'paste' })
      else if (key === 'd' && selectedIds.length) { e.preventDefault(); dispatch({ type: 'copy', ids: selectedIds }); dispatch({ type: 'paste' }) }
```

  Keep the serialize→autosave effect, now keyed on `nodes, edges` from `state` (no change to its body). Update `<ChainCanvas>` to pass `onSelectionChange={setSelectedIds}` and `onSelect={(id) => setSelectedIds(id ? [id] : [])}` (same as Group A, now backed by dispatch). Remove the now-unused `useState` and `copySubgraph`/`pasteSubgraph` imports if nothing else uses them directly.

- [ ] **Step 6: Typecheck + manual verification**

Run: `npx tsc --noEmit` (expect no errors), then `npm run dev`:
- All Group-A behaviors still work: add node, connect, move, delete, multi-select, copy/paste/duplicate, group-drag persistence, agent drawer.
- Autosave status still cycles to `saved` after edits.

- [ ] **Step 7: Commit**

```bash
git add lib/editorReducer.ts tests/editor-reducer.test.ts components/editor/ChainEditor.tsx
git commit -m "refactor: single useReducer (applyEditorAction) for the chain editor"
```

---

## Task 3: Undo/redo (§2.3)

Wrap the reducer in a history meta-reducer and bind Ctrl/Cmd+Z / Shift+Z.

**Files:**
- Create: `lib/history.ts`
- Test: `tests/history.test.ts`
- Modify: `components/editor/ChainEditor.tsx`

**Interfaces:**
- Consumes: `applyEditorAction`, `EditorState`, `EditorAction`, `NON_HISTORIC` (Task 2).
- Produces:
  - `interface History<S> { past: S[]; present: S; future: S[] }`
  - `withHistory<S, A extends { type: string }>(reducer, isHistoric, cap?): (state: History<S>, action: A | { type: 'undo' } | { type: 'redo' }) => History<S>`
  - `canUndo(h)`, `canRedo(h)`

- [ ] **Step 1: Write the failing tests.** New file `tests/history.test.ts`:

```ts
import assert from 'node:assert'
import { withHistory, canUndo, canRedo, History } from '../lib/history'

type S = { n: number; sel: number }
type A = { type: 'inc' } | { type: 'select'; v: number }
const base = (s: S, a: A): S =>
  a.type === 'inc' ? { ...s, n: s.n + 1 } : { ...s, sel: a.v }
const reducer = withHistory<S, A>(base, a => a.type !== 'select', 3)

let h: History<S> = { past: [], present: { n: 0, sel: 0 }, future: [] }

// a historic action pushes onto past
h = reducer(h, { type: 'inc' })
assert.strictEqual(h.present.n, 1)
assert.ok(canUndo(h) && !canRedo(h))

// undo restores, redo re-applies
h = reducer(h, { type: 'undo' })
assert.strictEqual(h.present.n, 0)
assert.ok(canRedo(h))
h = reducer(h, { type: 'redo' })
assert.strictEqual(h.present.n, 1)

// a non-historic action (select) does NOT create a history entry
const before = h.past.length
h = reducer(h, { type: 'select', v: 5 })
assert.strictEqual(h.past.length, before)
assert.strictEqual(h.present.sel, 5)

// a new action clears the redo future
h = reducer(h, { type: 'undo' })
h = reducer(h, { type: 'inc' })
assert.ok(!canRedo(h))

// cap is enforced
let c: History<S> = { past: [], present: { n: 0, sel: 0 }, future: [] }
for (let i = 0; i < 10; i++) c = reducer(c, { type: 'inc' })
assert.ok(c.past.length <= 3)

console.log('✅ history tests passed')
```

- [ ] **Step 2: Run to verify failure**

Run: `npx tsx tests/history.test.ts`
Expected: FAIL — cannot find module `../lib/history`.

- [ ] **Step 3: Implement.** New file `lib/history.ts`:

```ts
export interface History<S> {
  past: S[]
  present: S
  future: S[]
}

export function withHistory<S, A extends { type: string }>(
  reducer: (s: S, a: A) => S,
  isHistoric: (a: A) => boolean,
  cap = 50,
) {
  return function (state: History<S>, action: A | { type: 'undo' } | { type: 'redo' }): History<S> {
    if (action.type === 'undo') {
      if (!state.past.length) return state
      const previous = state.past[state.past.length - 1]
      return { past: state.past.slice(0, -1), present: previous, future: [state.present, ...state.future] }
    }
    if (action.type === 'redo') {
      if (!state.future.length) return state
      const next = state.future[0]
      return { past: [...state.past, state.present], present: next, future: state.future.slice(1) }
    }
    const present = reducer(state.present, action as A)
    if (present === state.present) return state
    if (!isHistoric(action as A)) return { ...state, present }
    const past = [...state.past, state.present]
    while (past.length > cap) past.shift()
    return { past, present, future: [] }
  }
}

export const canUndo = <S>(h: History<S>): boolean => h.past.length > 0
export const canRedo = <S>(h: History<S>): boolean => h.future.length > 0
```

- [ ] **Step 4: Run to verify pass**

Run: `npx tsx tests/history.test.ts`
Expected: PASS — `✅ history tests passed`.

- [ ] **Step 5: Wrap the editor reducer with history.** In `components/editor/ChainEditor.tsx`:

  Replace the `useReducer(applyEditorAction, …)` from Task 2 with the history-wrapped version:

```ts
  const historced = useMemo(() => withHistory(applyEditorAction, (a: EditorAction) => !NON_HISTORIC.has(a.type)), [])
  const [hist, dispatch] = useReducer(historced, undefined, () => ({
    past: [],
    present: {
      nodes: seedPositions(initialChain.nodes, initialChain.edges),
      edges: initialChain.edges,
      selectedIds: [] as string[],
      clipboard: null,
    },
    future: [],
  }))
  const { nodes, edges, selectedIds, clipboard } = hist.present
  const primaryId = selectedIds[0] ?? null
```

  All existing `dispatch({ type: '…' })` handler calls are unchanged (they pass through to the inner reducer). Add undo/redo to the existing key handler (input-guarded block from Group A):

```ts
      if ((e.metaKey || e.ctrlKey) && key === 'z' && !e.shiftKey) { e.preventDefault(); dispatch({ type: 'undo' }) }
      else if ((e.metaKey || e.ctrlKey) && (key === 'y' || (key === 'z' && e.shiftKey))) { e.preventDefault(); dispatch({ type: 'redo' }) }
```

  Add the imports: `withHistory, canUndo, canRedo` from `@/lib/history`; `NON_HISTORIC` from `@/lib/editorReducer`. Optionally add Undo/Redo toolbar buttons next to Run, disabled via `!canUndo(hist)` / `!canRedo(hist)` dispatching `{type:'undo'}` / `{type:'redo'}`.

- [ ] **Step 6: Manual verification**

Run: `npm run dev`:
- Add/move/connect/delete nodes, then Ctrl/Cmd+Z repeatedly steps each change back; Ctrl/Cmd+Shift+Z (or Ctrl+Y) re-applies.
- A single drag = one undo step (not many). Selecting nodes is **not** undoable.
- After undoing then making a new edit, redo is unavailable.
- Undo persists: after undo, autosave writes the reverted graph.

- [ ] **Step 7: Commit**

```bash
git add lib/history.ts tests/history.test.ts components/editor/ChainEditor.tsx
git commit -m "feat: undo/redo via a history meta-reducer over the editor state"
```

---

## Task 4: Partial run — "run up to here" (§2.1)

Truncate the graph to a target's upstream ancestors (expanding zones) and run that subgraph inline.

**Files:**
- Create: `lib/partialRun.ts`
- Test: `tests/partial-run.test.ts`
- Modify: `components/editor/ChainEditor.tsx`

**Interfaces:**
- Consumes: `ChainDef`, `ChainNode`, `ChainEdge`; the inline-run endpoint (Task 1).
- Produces: `upstreamSubgraph(chain: ChainDef, targetId: string): { nodes: ChainNode[]; edges: ChainEdge[] }`; `ChainEditor.runUpTo(targetId: string)`.

- [ ] **Step 1: Write the failing tests.** New file `tests/partial-run.test.ts`:

```ts
import assert from 'node:assert'
import { upstreamSubgraph } from '../lib/partialRun'
import { ChainDef } from '../lib/types'

const edge = (f: string, t: string) => ({ fromNode: f, fromSocket: 'output', toNode: t, toSocket: 'input' })

// linear a->b->c->d ; target c keeps {a,b,c}, drops d
const linear: ChainDef = {
  slug: 'x', name: 'x', description: '', filePath: '',
  nodes: ['a', 'b', 'c', 'd'].map(id => ({ id, kind: 'agent' as const, agent: 'z' })),
  edges: [edge('a', 'b'), edge('b', 'c'), edge('c', 'd')],
}
const up = upstreamSubgraph(linear, 'c')
assert.deepStrictEqual(up.nodes.map(n => n.id).sort(), ['a', 'b', 'c'])
assert.strictEqual(up.edges.length, 2)

// unrelated branch is excluded: a->b, x->b ; target a keeps only {a}
const branchy: ChainDef = {
  slug: 'y', name: 'y', description: '', filePath: '',
  nodes: ['a', 'b', 'x'].map(id => ({ id, kind: 'agent' as const, agent: 'z' })),
  edges: [edge('a', 'b'), edge('x', 'b')],
}
assert.deepStrictEqual(upstreamSubgraph(branchy, 'a').nodes.map(n => n.id), ['a'])

// zone expansion: a body member pulls in the whole zone
const looped: ChainDef = {
  slug: 'z', name: 'z', description: '', filePath: '',
  nodes: [
    { id: 'ls', kind: 'loop-start', zone: 'z1', state: [] },
    { id: 'body', kind: 'agent', agent: 'z', zone: 'z1' },
    { id: 'le', kind: 'loop-end', zone: 'z1', until: '', maxIterations: 2 },
  ],
  edges: [edge('ls', 'body'), edge('body', 'le')],
}
assert.deepStrictEqual(upstreamSubgraph(looped, 'body').nodes.map(n => n.id).sort(), ['body', 'le', 'ls'])

console.log('✅ partial-run tests passed')
```

- [ ] **Step 2: Run to verify failure**

Run: `npx tsx tests/partial-run.test.ts`
Expected: FAIL — cannot find module `../lib/partialRun`.

- [ ] **Step 3: Implement.** New file `lib/partialRun.ts`:

```ts
import { ChainDef, ChainNode, ChainEdge } from './types'

// All ancestors of targetId (incl. itself), with any touched loop zone fully included.
export function upstreamSubgraph(chain: ChainDef, targetId: string): { nodes: ChainNode[]; edges: ChainEdge[] } {
  const incoming = new Map<string, string[]>()
  for (const e of chain.edges) {
    const arr = incoming.get(e.toNode) ?? []
    arr.push(e.fromNode)
    incoming.set(e.toNode, arr)
  }
  const zoneOf = new Map(chain.nodes.map(n => [n.id, n.zone]))
  const keep = new Set<string>([targetId])

  let changed = true
  while (changed) {
    changed = false
    // pull in ancestors of everything currently kept
    for (const id of [...keep]) {
      for (const src of incoming.get(id) ?? []) {
        if (!keep.has(src)) { keep.add(src); changed = true }
      }
    }
    // pull in every member of any zone we've touched
    const zones = new Set<string>()
    for (const id of keep) { const z = zoneOf.get(id); if (z) zones.add(z) }
    for (const n of chain.nodes) {
      if (n.zone && zones.has(n.zone) && !keep.has(n.id)) { keep.add(n.id); changed = true }
    }
  }

  return {
    nodes: chain.nodes.filter(n => keep.has(n.id)),
    edges: chain.edges.filter(e => keep.has(e.fromNode) && keep.has(e.toNode)),
  }
}
```

- [ ] **Step 4: Run to verify pass**

Run: `npx tsx tests/partial-run.test.ts`
Expected: PASS — `✅ partial-run tests passed`.

- [ ] **Step 5: Add `runUpTo` to the editor.** In `components/editor/ChainEditor.tsx`, factor the streaming body out of `run` into a shared `streamInline(graphNodes, graphEdges)` (so `run` and `runUpTo` share it), then:

```ts
  const streamInline = useCallback(async (gNodes: ChainNode[], gEdges: ChainEdge[]) => {
    setRunError(null); setRunState({}); setRunning(true)
    try {
      const res = await fetch('/api/run', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chain: { name: meta.name, description: meta.description, nodes: gNodes, edges: gEdges }, seedPrompt, type: 'chain', slug }),
      })
      if (!res.ok) {
        const b = await res.json().catch(() => ({}))
        setRunError((b.errors as string[] | undefined)?.join('; ') ?? b.error ?? `Run failed (${res.status})`); return
      }
      const reader = res.body?.getReader(); if (!reader) return
      await streamRun(reader, e => { if (e.type === 'error') { setRunError(e.error); return } setRunState(prev => applyRunEvent(prev, e)) })
    } catch (err) {
      setRunError(err instanceof Error ? err.message : String(err))
    } finally { setRunning(false) }
  }, [meta, seedPrompt, slug])

  const run = useCallback(() => streamInline(nodes, edges), [streamInline, nodes, edges])

  const runUpTo = useCallback((targetId: string) => {
    const sub = upstreamSubgraph({ ...initialChain, nodes, edges }, targetId)
    return streamInline(sub.nodes, sub.edges)
  }, [streamInline, initialChain, nodes, edges])
```

  Add the import: `import { upstreamSubgraph } from '@/lib/partialRun'`.

- [ ] **Step 6: Manual verification**

Run: `npm run dev`. Build a chain `seed → A → B → C`. Trigger `runUpTo('B')` (temporarily wire it to a button, or proceed to Task 5 which adds the per-node trigger):
- Only `seed`, `A`, `B` show run activity/output; `C` stays idle.
- `runUpTo` on a node inside a loop zone runs the whole zone.

- [ ] **Step 7: Commit**

```bash
git add lib/partialRun.ts tests/partial-run.test.ts components/editor/ChainEditor.tsx
git commit -m "feat: partial run — execute a target node's upstream subgraph inline"
```

---

## Task 5: Per-node preview (§2.2)

A "▶ from here" affordance on each node that runs up to it and shows its output.

**Files:**
- Modify: `components/editor/nodeData.ts`
- Modify: `components/editor/nodes/AgentNode.tsx` (and the other node components that should support it — at minimum `AgentNode`, `GateNode`, `BranchNode`)
- Modify: `components/editor/ChainEditor.tsx`

**Interfaces:**
- Consumes: `runUpTo` (Task 4), the existing `NodePreview` pane (`run`/`nodeId` props) and `runState`.
- Produces: `EditorNodeData.onRunFromHere?: (id: string) => void`.

- [ ] **Step 1: Add the callback to `EditorNodeData`.** In `components/editor/nodeData.ts`, add inside the interface:

```ts
  onRunFromHere?: (id: string) => void
```

- [ ] **Step 2: Render the button.** In `components/editor/nodes/AgentNode.tsx`, in the header row (next to the kind label / issue badge), add:

```tsx
        <button
          onClick={() => data.onRunFromHere?.(node.id)}
          title="Run up to here"
          className="nodrag ml-auto text-[9px] font-bold text-zinc-400 hover:text-zinc-900"
        >
          ▶ here
        </button>
```

  (If an issue badge already uses `ml-auto`, wrap both in a right-aligned flex container so they don't fight for the margin.) Repeat the same button in `GateNode.tsx` and `BranchNode.tsx` header rows.

- [ ] **Step 3: Wire it in `ChainEditor`.** In `buildData`, add the callback that selects the target (so the existing `NodePreview` shows it) and runs up to it:

```ts
    onRunFromHere: (id: string) => { dispatch({ type: 'setSelection', ids: [id] }); runUpTo(id) },
```

  Add `runUpTo` to the `buildData` dependency array.

- [ ] **Step 4: Manual verification**

Run: `npm run dev`:
- Each agent/gate/branch node shows a **▶ here** button. Clicking it runs only that node's upstream subgraph, selects the node, and the bottom `NodePreview` pane shows its streamed output.
- Downstream nodes stay idle (no run dot).

- [ ] **Step 5: Commit**

```bash
git add components/editor/nodeData.ts components/editor/nodes/AgentNode.tsx components/editor/nodes/GateNode.tsx components/editor/nodes/BranchNode.tsx components/editor/ChainEditor.tsx
git commit -m "feat: per-node 'run up to here' preview affordance"
```

---

## Task 6: Drag-into-zone membership (§2.6)

Set a node's `zone` by dropping it inside a zone frame; clear it when dropped outside.

**Files:**
- Modify: `lib/zoneFrames.ts`
- Test: `tests/zone-frames.test.ts`
- Modify: `components/editor/ChainEditor.tsx`

**Interfaces:**
- Consumes: `computeZoneFrames`, `ZoneFrameBox`, `NODE_W`, `NODE_H` (`lib/zoneFrames.ts`).
- Produces: `zoneAtPoint(frames: ZoneFrameBox[], x: number, y: number): string | undefined`.

- [ ] **Step 1: Write the failing tests.** Append to `tests/zone-frames.test.ts` (before its final `console.log`), and add `zoneAtPoint` to the import from `../lib/zoneFrames`:

```ts
// --- §2.6 zoneAtPoint ---
import { zoneAtPoint } from '../lib/zoneFrames'

const frames = computeZoneFrames([
  { id: 'ls', kind: 'loop-start', zone: 'z1', pos: [100, 100] },
  { id: 'le', kind: 'loop-end', zone: 'z1', pos: [400, 100] },
])
const f = frames[0]
// a point well inside the frame returns the zone
assert.strictEqual(zoneAtPoint(frames, f.x + 10, f.y + 10), 'z1')
// a point far outside returns undefined
assert.strictEqual(zoneAtPoint(frames, f.x - 50, f.y - 50), undefined)
```

  > `computeZoneFrames` is already imported at the top of this test file from the existing suite; if not, add it to that import.

- [ ] **Step 2: Run to verify failure**

Run: `npx tsx tests/zone-frames.test.ts`
Expected: FAIL — `zoneAtPoint` is not exported.

- [ ] **Step 3: Implement.** Append to `lib/zoneFrames.ts`:

```ts
// Return the zone whose frame contains (x, y), if any.
export function zoneAtPoint(frames: ZoneFrameBox[], x: number, y: number): string | undefined {
  for (const f of frames) {
    if (x >= f.x && x <= f.x + f.width && y >= f.y && y <= f.y + f.height) return f.zone
  }
  return undefined
}
```

- [ ] **Step 4: Run to verify pass**

Run: `npx tsx tests/zone-frames.test.ts`
Expected: PASS — ends with the file's existing `✅ … passed` line.

- [ ] **Step 5: Reassign membership on drop.** In `components/editor/ChainEditor.tsx`, change `moveNode` so a single-node drop recomputes its zone (boundary nodes keep their zone; group drags via `moveMany` are unaffected in v1):

```ts
  const moveNode = useCallback((id: string, pos: [number, number]) => {
    const node = nodes.find(n => n.id === id)
    if (!node || node.kind === 'loop-start' || node.kind === 'loop-end') {
      dispatch({ type: 'moveNode', id, pos }); return
    }
    const frames = computeZoneFrames(nodes.filter(n => n.id !== id))
    const zone = zoneAtPoint(frames, pos[0] + NODE_W / 2, pos[1] + NODE_H / 2)
    dispatch({ type: 'updateNode', id, patch: { pos, zone } })
  }, [nodes])
```

  Add the imports: `import { computeZoneFrames, zoneAtPoint, NODE_W, NODE_H } from '@/lib/zoneFrames'`.

  > Note: `updateNode` with `patch.zone = undefined` clears membership; `serializeChain` already omits an undefined `zone`. This is a single dispatch, so it is one undo entry.

- [ ] **Step 6: Manual verification**

Run: `npm run dev`, open a chain with a loop zone:
- Drag a plain agent node so its center lands inside the zone frame → on drop it joins the zone (the frame grows to include it; reload confirms `zone` persisted).
- Drag it back out → `zone` clears.
- Dragging a now-illegal cross-zone edge's endpoints surfaces a validation issue (not an auto-delete).
- Dragging the loop-start/loop-end themselves moves them but does **not** change their zone.

- [ ] **Step 7: Commit**

```bash
git add lib/zoneFrames.ts tests/zone-frames.test.ts components/editor/ChainEditor.tsx
git commit -m "feat: drag-into-zone membership via frame hit-testing"
```

---

## Self-Review

**Spec coverage (Group B of the design doc):**
- §1.1 inline-chain run → Task 1 (`resolveRunChain` + inline branch + editor drops flush). ✓
- §1.2 editor reducer → Task 2 (`applyEditorAction` owning `{nodes,edges,selectedIds,clipboard}`; runState/seed stay out). ✓
- §2.3 undo/redo → Task 3 (`withHistory`; non-historic `setSelection`/`copy`/`setGraph`; one-entry-per-drag; cap). ✓
- §2.1 partial run → Task 4 (`upstreamSubgraph` ancestors + zone expansion; runs inline; executor untouched). ✓
- §2.2 per-node preview → Task 5 (`onRunFromHere`, auto-select, reuse `NodePreview`). ✓
- §2.6 drag-into-zone → Task 6 (`zoneAtPoint`; boundary nodes preserved; non-destructive validation). ✓

**Placeholder scan:** No TBD/TODO; pure modules have complete code + tests; UI steps list concrete expected outcomes. ✓

**Type consistency:** `resolveRunChain`/`ResolvedRun`/`RunChainBody`; `EditorState`/`EditorAction`/`applyEditorAction`/`NON_HISTORIC`; `History`/`withHistory`/`canUndo`/`canRedo`; `upstreamSubgraph`; `zoneAtPoint`; `EditorNodeData.onRunFromHere` — defined once and consumed by name across tasks. `dispatch` actions used in Tasks 4–6 (`setSelection`, `updateNode`, `moveNode`) all exist in the Task 2 `EditorAction` union. ✓

**Sequencing note:** Tasks 4–6 wire against the reducer/history from Tasks 2–3. If implemented out of order, the dispatch calls won't exist — keep the task order.

**Out of scope (deferred per design):** `startOutputs` replay composition for partial runs; group-drag zone reassignment; mid-drag undo coalescing.
