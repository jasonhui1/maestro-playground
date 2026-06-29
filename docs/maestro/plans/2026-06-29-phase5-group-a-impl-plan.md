# Phase 5 — Group A (Easy) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the three editor-local Phase 5 items — multi-select + copy/paste (§2.5), inline agent prompt editing (§2.7), and author-a-chain-from-template (§2.9) — with zero executor or data-model changes.

**Architecture:** Pure clipboard/fork logic lives in `lib/*` and is unit-tested; React wiring in `ChainEditor`/`ChainCanvas`/`Sidebar` stays thin and is verified by running the dev server. Persistence keeps round-tripping through the existing `serializeChain` + `/api/workspace` paths — no new save surface.

**Tech Stack:** Next.js (app router), React, `@xyflow/react` (React Flow), `gray-matter`, `tsx` for tests.

**Design source:** `docs/maestro/plans/2026-06-29-phase5-backlog-design.md` (Group A section).

## Global Constraints

- **Next.js 16 — consult the project skill.** Before writing route-handler code (Task 5), read `.agents/skills/nextjs16.md` (authoritative), then `node_modules/next/dist/docs/` for anything it doesn't cover. Gotchas that bite here: `params`/`searchParams`/`cookies()`/`headers()` are **async — `await` them**; `GET` route handlers are **not cached** by default. The existing `POST /api/workspace` already follows these — mirror it.
- **React Flow v12 (@xyflow/react) — consult the project skill.** Before touching the canvas (Tasks 1–2), read `.agents/skills/xyflow12.md`. Gotchas that bite here: **named imports only** (`import { ReactFlow }`), **never mutate nodes/edges** (always spread — the ops already do), measured sizes live at `node.measured.*`, and keep `onSelectionChange` handlers stable (memoized) to avoid re-render churn.
- **Tests are framework-free scripts.** Each test file uses `import assert from 'node:assert'`, runs with `npx tsx tests/<file>.test.ts`, and ends with `console.log('✅ <name> tests passed')`. No Jest/Vitest.
- **React components are not unit-tested** in this repo — UI tasks end with explicit manual-verification steps against `npm run dev`, then a commit.
- **One commit per task.** Commit messages are conventional (`feat:`, `refactor:`, `test:`).
- **Filesystem-first.** Chain persistence goes through `serializeChain`/`chainToData` + `saveWorkspaceEntity`; never hand-roll frontmatter.
- **Primary selection rule:** wherever a single "focused" node is needed (preview, validation jump, agent drawer), it is `selectedIds[0]`.

---

## File Structure

**Create:**
- `components/editor/AgentDrawer.tsx` — side drawer that edits the selected agent's `.md` via the existing GET/PUT + `useAutoSave`.
- `lib/fs/forkChain.ts` — pure `buildChainFromTemplate(...)` (copy a template's referenced chain graph).
- `tests/fork-chain.test.ts` — unit tests for the fork builder.

**Modify:**
- `lib/editorOps.ts` — add `copySubgraph` / `pasteSubgraph` (+ `Subgraph` type).
- `tests/editor-ops.test.ts` — add clipboard tests.
- `lib/serializeChain.ts` — extract & export `chainToData(meta, nodes, edges)`.
- `components/editor/nodeData.ts` — add `onEditAgent?` to `EditorNodeData`.
- `components/editor/nodes/AgentNode.tsx` — "Edit agent" affordance.
- `components/editor/ChainCanvas.tsx` — multi-select (`selectedIds`, `onSelectionChange`), group-drag persistence (`onSelectionDragStop` → `onMoveMany`).
- `components/editor/ChainEditor.tsx` — `selectedIds`, clipboard + key bindings, `moveMany`, agent drawer, `refetchAgents` + `initialSeedPrompt` props.
- `app/workspace/page.tsx` — `refetchEditorData()` + read `seed` query param → `initialSeedPrompt`.
- `app/api/workspace/route.ts` — optional `fromTemplate` branch in `POST`.
- `components/workspace/Sidebar.tsx` — template picker in the chain-creation modal + seed pass-through.

---

## Task 1: Clipboard ops (§2.5 core, TDD)

Pure copy/paste logic over `{nodes, edges}` — the testable heart of multi-select.

**Files:**
- Modify: `lib/editorOps.ts`
- Test: `tests/editor-ops.test.ts`

**Interfaces:**
- Consumes: `uniqueNodeId(kind, existing)` (already in `lib/editorOps.ts`), `ChainNode`/`ChainEdge` from `lib/types.ts`.
- Produces:
  - `interface Subgraph { nodes: ChainNode[]; edges: ChainEdge[] }`
  - `copySubgraph(nodes: ChainNode[], edges: ChainEdge[], ids: string[]): Subgraph`
  - `pasteSubgraph(clip: Subgraph, existingIds: string[], offset: [number, number]): { nodes: ChainNode[]; edges: ChainEdge[]; newIds: string[] }`

- [ ] **Step 1: Write the failing tests** — append to `tests/editor-ops.test.ts` (before the final `console.log`), and add `copySubgraph, pasteSubgraph, Subgraph` to the existing import from `../lib/editorOps`:

```ts
// --- §2.5 clipboard ---
import { copySubgraph, pasteSubgraph } from '../lib/editorOps'
import type { Subgraph } from '../lib/editorOps'

// copySubgraph keeps only edges internal to the selection
const csNodes: ChainNode[] = [
  { id: 'a', kind: 'seed' },
  { id: 'b', kind: 'agent', agent: 'x', pos: [10, 20] },
  { id: 'c', kind: 'agent', agent: 'y' },
]
const csEdges: ChainEdge[] = [
  { fromNode: 'a', fromSocket: 'output', toNode: 'b', toSocket: 'input' },
  { fromNode: 'b', fromSocket: 'output', toNode: 'c', toSocket: 'input' },
]
const clip = copySubgraph(csNodes, csEdges, ['b', 'c'])
assert.strictEqual(clip.nodes.length, 2)
assert.strictEqual(clip.edges.length, 1)            // only b->c is internal
assert.strictEqual(clip.edges[0].fromNode, 'b')

// pasteSubgraph mints fresh ids (no collision), remaps edges, offsets pos
const pasted = pasteSubgraph(clip, ['b', 'c'], [40, 40])
assert.strictEqual(pasted.nodes.length, 2)
assert.ok(!pasted.newIds.includes('b') && !pasted.newIds.includes('c'))
assert.ok(pasted.newIds.includes(pasted.edges[0].fromNode))
assert.ok(pasted.newIds.includes(pasted.edges[0].toNode))
const pb = pasted.nodes.find(n => n.agent === 'x')!
assert.deepStrictEqual(pb.pos, [50, 60])            // [10,20] + [40,40]

// pasteSubgraph mints a fresh, shared zone id for a copied loop pair
const loopClip: Subgraph = {
  nodes: [
    { id: 'loop-start-1', kind: 'loop-start', zone: 'zone-1', state: [] },
    { id: 'loop-end-1', kind: 'loop-end', zone: 'zone-1', until: '', maxIterations: 3 },
  ],
  edges: [],
}
const loopPasted = pasteSubgraph(loopClip, ['loop-start-1', 'loop-end-1', 'zone-1'], [0, 0])
assert.strictEqual(loopPasted.nodes[0].zone, loopPasted.nodes[1].zone)  // shared
assert.notStrictEqual(loopPasted.nodes[0].zone, 'zone-1')               // fresh
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx tsx tests/editor-ops.test.ts`
Expected: FAIL — `copySubgraph`/`pasteSubgraph` are not exported (`SyntaxError` / `is not a function`).

- [ ] **Step 3: Implement the ops** — append to `lib/editorOps.ts`:

```ts
export interface Subgraph {
  nodes: ChainNode[]
  edges: ChainEdge[]
}

// Selected nodes plus only the edges whose BOTH endpoints are in the selection.
export function copySubgraph(nodes: ChainNode[], edges: ChainEdge[], ids: string[]): Subgraph {
  const set = new Set(ids)
  return {
    nodes: nodes.filter(n => set.has(n.id)).map(n => structuredClone(n)),
    edges: edges.filter(e => set.has(e.fromNode) && set.has(e.toNode)).map(e => ({ ...e })),
  }
}

// Clone a subgraph with fresh node ids, fresh zone ids, remapped edges and offset positions.
export function pasteSubgraph(
  clip: Subgraph,
  existingIds: string[],
  offset: [number, number],
): { nodes: ChainNode[]; edges: ChainEdge[]; newIds: string[] } {
  const taken = [...existingIds]
  const idMap = new Map<string, string>()
  for (const n of clip.nodes) {
    const fresh = uniqueNodeId(n.kind, taken)
    idMap.set(n.id, fresh)
    taken.push(fresh)
  }
  const zoneMap = new Map<string, string>()
  for (const n of clip.nodes) {
    if (n.zone && !zoneMap.has(n.zone)) {
      const freshZone = uniqueNodeId('zone', taken)
      zoneMap.set(n.zone, freshZone)
      taken.push(freshZone)
    }
  }
  const nodes: ChainNode[] = clip.nodes.map(n => {
    const copy = structuredClone(n)
    copy.id = idMap.get(n.id)!
    if (n.zone) copy.zone = zoneMap.get(n.zone)!
    const [x, y] = n.pos ?? [0, 0]
    copy.pos = [x + offset[0], y + offset[1]]
    return copy
  })
  const edges: ChainEdge[] = clip.edges.map(e => ({
    fromNode: idMap.get(e.fromNode)!,
    fromSocket: e.fromSocket,
    toNode: idMap.get(e.toNode)!,
    toSocket: e.toSocket,
  }))
  return { nodes, edges, newIds: [...idMap.values()] }
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx tsx tests/editor-ops.test.ts`
Expected: PASS — ends with `✅ editor-ops tests passed`.

- [ ] **Step 5: Commit**

```bash
git add lib/editorOps.ts tests/editor-ops.test.ts
git commit -m "feat: add copySubgraph/pasteSubgraph clipboard ops for the chain editor"
```

---

## Task 2: Multi-select + copy/paste wiring (§2.5 UI)

Lift selection to `selectedIds`, render group selection, persist group drags, and bind Ctrl/Cmd+C/V/D.

**Files:**
- Modify: `components/editor/ChainCanvas.tsx`
- Modify: `components/editor/ChainEditor.tsx`

**Interfaces:**
- Consumes: `copySubgraph`, `pasteSubgraph`, `Subgraph` (Task 1).
- Produces (props on `ChainCanvas`): `selectedIds: string[]`, `onSelectionChange(ids: string[])`, `onMoveMany(updates: { id: string; pos: [number, number] }[])` (replaces the singular `selectedId`/`onSelect`-only model; `onSelect`, `onMove`, `onConnect`, `onDeleteNode`, `onDeleteEdge` stay).

- [ ] **Step 1: Update `ChainCanvas` to multi-select.** In `components/editor/ChainCanvas.tsx`:

  Change the props interface — replace `selectedId: string | null` with `selectedIds: string[]` and add two handlers:

```ts
interface ChainCanvasProps {
  nodes: ChainNode[]
  edges: ChainEdge[]
  buildData: (node: ChainNode) => EditorNodeData
  selectedIds: string[]
  onSelectionChange: (ids: string[]) => void
  onSelect: (id: string | null) => void
  onMove: (id: string, pos: [number, number]) => void
  onMoveMany: (updates: { id: string; pos: [number, number] }[]) => void
  onConnect: (edge: ChainEdge) => void
  onDeleteNode: (id: string) => void
  onDeleteEdge: (edge: ChainEdge) => void
}
```

  In the `rfNodes` memo, set selection from membership and add `selectedIds` to the dep array:

```ts
    const nodes: Node[] = props.nodes.map(n => ({
      id: n.id,
      type: n.kind,
      position: { x: n.pos?.[0] ?? 0, y: n.pos?.[1] ?? 0 },
      data: props.buildData(n),
      selected: props.selectedIds.includes(n.id),
    }))
    return [...frames, ...nodes]
  }, [props.nodes, props.selectedIds, props.buildData])
```

  On the `<ReactFlow>` element, add selection + group-drag handlers (keep the existing ones). Import `type OnSelectionChangeParams`:

```tsx
          onSelectionChange={({ nodes }: { nodes: Node[] }) =>
            props.onSelectionChange(nodes.map(n => n.id))
          }
          onSelectionDragStop={(_, nodes) =>
            props.onMoveMany(nodes.map(n => ({ id: n.id, pos: [n.position.x, n.position.y] as [number, number] })))
          }
          selectionKeyCode="Shift"
          multiSelectionKeyCode={['Meta', 'Control']}
```

  > Next.js note: React Flow's `onSelectionChange` must run inside the existing `<ReactFlowProvider>` (it already wraps `<ReactFlow>` here) — no change needed, just don't move it out.

- [ ] **Step 2: Wire `ChainEditor` selection state.** In `components/editor/ChainEditor.tsx`:

  Replace the selection state:

```ts
  const [selectedIds, setSelectedIds] = useState<string[]>([])
  const primaryId = selectedIds[0] ?? null
```

  Update the four `selectedId` consumers:
  - `deleteNode` callback: `if (selectedIds.includes(id)) setSelectedIds(prev => prev.filter(x => x !== id))` (and its dep array → `[selectedIds]`).
  - `<ValidationPanel … onSelect={(id) => setSelectedIds([id])} />`
  - `<NodePreview run={primaryId ? runState[primaryId] : undefined} nodeId={primaryId} />`
  - The `<ChainCanvas>` props (next step).

- [ ] **Step 3: Add clipboard state, `moveMany`, paste helper, and key bindings** in `ChainEditor`:

```ts
  const [clipboard, setClipboard] = useState<Subgraph | null>(null)

  const moveMany = useCallback((updates: { id: string; pos: [number, number] }[]) => {
    const m = new Map(updates.map(u => [u.id, u.pos]))
    setNodes(prev => prev.map(n => (m.has(n.id) ? { ...n, pos: m.get(n.id)! } : n)))
  }, [])

  const pasteClip = useCallback((clip: Subgraph) => {
    setNodes(prev => {
      const { nodes: add, edges: addE, newIds } = pasteSubgraph(clip, prev.map(n => n.id), [40, 40])
      setEdges(prevE => [...prevE, ...addE])
      setSelectedIds(newIds)
      return [...prev, ...add]
    })
  }, [])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return
      if (!(e.metaKey || e.ctrlKey)) return
      const key = e.key.toLowerCase()
      if (key === 'c' && selectedIds.length) {
        setClipboard(copySubgraph(nodes, edges, selectedIds))
      } else if (key === 'v' && clipboard) {
        pasteClip(clipboard)
      } else if (key === 'd' && selectedIds.length) {
        e.preventDefault()
        pasteClip(copySubgraph(nodes, edges, selectedIds))
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [nodes, edges, selectedIds, clipboard, pasteClip])
```

  Add the imports at the top: `copySubgraph, pasteSubgraph` (and `type Subgraph`) from `@/lib/editorOps`.

- [ ] **Step 4: Update the `<ChainCanvas>` props** in `ChainEditor`'s JSX:

```tsx
          <ChainCanvas
            nodes={nodes}
            edges={edges}
            buildData={buildData}
            selectedIds={selectedIds}
            onSelectionChange={setSelectedIds}
            onSelect={(id) => setSelectedIds(id ? [id] : [])}
            onMove={moveNode}
            onMoveMany={moveMany}
            onConnect={connect}
            onDeleteNode={deleteNode}
            onDeleteEdge={deleteEdge}
          />
```

- [ ] **Step 5: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors referencing `selectedId`, `selectedIds`, `onMoveMany`, or `ChainCanvas`.

- [ ] **Step 6: Manual verification**

Run: `npm run dev`, open a chain in Graph mode, then confirm:
- Shift-drag on the canvas draws a selection box and selects multiple nodes (all show the selected ring).
- Dragging the group moves all selected nodes together; after release they **stay** moved (no snap-back) — reload the page and positions persist.
- Ctrl/Cmd+C then Ctrl/Cmd+V adds duplicated nodes offset by ~40px, with internal edges preserved and the new copies selected.
- Ctrl/Cmd+D duplicates the current selection in one keystroke.
- Selecting one node still shows it in the bottom `NodePreview` pane; clicking a validation issue still jumps to its node.
- Typing in the seed-prompt input and pressing `c`/`v`/`d` does **not** trigger copy/paste.

- [ ] **Step 7: Commit**

```bash
git add components/editor/ChainCanvas.tsx components/editor/ChainEditor.tsx
git commit -m "feat: multi-select, group-drag persistence, and copy/paste in the chain editor"
```

---

## Task 3: Inline agent prompt editing (§2.7)

A side drawer that edits the selected agent node's underlying `.md` through the existing endpoints — agents stay their own files.

**Files:**
- Create: `components/editor/AgentDrawer.tsx`
- Modify: `components/editor/nodeData.ts`
- Modify: `components/editor/nodes/AgentNode.tsx`
- Modify: `components/editor/ChainEditor.tsx`
- Modify: `app/workspace/page.tsx`

**Interfaces:**
- Consumes: `useAutoSave('agent', slug, raw)` (`hooks/useAutoSave.ts`), `FileEditor` (`components/workspace/FileEditor`), `GET /api/workspace/agent/[slug]` (returns `{ raw }`).
- Produces: `AgentDrawer` (default export) with props `{ slug: string; agentName: string; onClose: () => void; onSaved?: () => void }`; `EditorNodeData.onEditAgent?: (slug: string) => void`; `ChainEditor` new optional prop `refetchAgents?: () => void`.

- [ ] **Step 1: Add `onEditAgent` to `EditorNodeData`.** In `components/editor/nodeData.ts`, add inside the interface (before the index signature):

```ts
  onEditAgent?: (slug: string) => void
```

- [ ] **Step 2: Create the drawer.** New file `components/editor/AgentDrawer.tsx`:

```tsx
'use client'
import React, { useEffect, useRef, useState } from 'react'
import { useAutoSave } from '@/hooks/useAutoSave'
import { FileEditor } from '@/components/workspace/FileEditor'
import { X, ExternalLink } from 'lucide-react'

export default function AgentDrawer({ slug, agentName, onClose, onSaved }: {
  slug: string
  agentName: string
  onClose: () => void
  onSaved?: () => void
}) {
  const [initial, setInitial] = useState<string | null>(null)

  useEffect(() => {
    let active = true
    setInitial(null)
    fetch(`/api/workspace/agent/${slug}`)
      .then(r => r.json())
      .then(d => { if (active) setInitial(d.raw ?? '') })
      .catch(() => { if (active) setInitial('') })
    return () => { active = false }
  }, [slug])

  return (
    <div className="absolute right-0 top-0 bottom-0 w-[380px] bg-white border-l border-zinc-200 shadow-xl z-30 flex flex-col">
      <div className="px-4 py-2 border-b border-zinc-100 flex items-center justify-between">
        <div>
          <div className="text-[10px] font-bold text-zinc-400 uppercase tracking-widest">Agent · its own file</div>
          <div className="text-sm font-bold text-zinc-900">{agentName}</div>
        </div>
        <div className="flex items-center gap-2">
          <a href={`/workspace?type=agent&slug=${slug}`} title="Open full file" className="text-zinc-400 hover:text-zinc-700">
            <ExternalLink size={14} />
          </a>
          <button onClick={onClose} title="Close" className="text-zinc-400 hover:text-zinc-700"><X size={16} /></button>
        </div>
      </div>
      <div className="flex-1 min-h-0 p-3">
        {initial === null
          ? <div className="text-xs text-zinc-400">Loading…</div>
          : <AgentDrawerEditor slug={slug} initial={initial} onSaved={onSaved} />}
      </div>
    </div>
  )
}

function AgentDrawerEditor({ slug, initial, onSaved }: { slug: string; initial: string; onSaved?: () => void }) {
  const { content, setContent, status, error } = useAutoSave('agent', slug, initial)
  const prev = useRef(status)
  useEffect(() => {
    if (prev.current !== 'saved' && status === 'saved') onSaved?.()
    prev.current = status
  }, [status, onSaved])
  return (
    <FileEditor content={content} onChange={setContent} status={status} error={error} type="agent" language="markdown" />
  )
}
```

- [ ] **Step 3: Add an "Edit agent" affordance.** In `components/editor/nodes/AgentNode.tsx`, inside the `<div className="px-4 py-2">`, right after the agent `<select>` block, add:

```tsx
        {node.agent && (
          <button
            onClick={() => data.onEditAgent?.(node.agent!)}
            className="nodrag mb-2 text-[10px] font-bold text-zinc-500 hover:text-zinc-900 uppercase tracking-widest"
          >
            Edit agent →
          </button>
        )}
```

- [ ] **Step 4: Mount the drawer in `ChainEditor`.** In `components/editor/ChainEditor.tsx`:

  Add the import: `import AgentDrawer from './AgentDrawer'`.

  Add the prop to the component signature (default undefined) and drawer state:

```ts
export default function ChainEditor({ slug, initialChain, agents, contextFiles, refetchAgents }: {
  slug: string
  initialChain: ChainDef
  agents: AgentDef[]
  contextFiles: { slug: string; name: string }[]
  refetchAgents?: () => void
}) {
```

```ts
  const [drawerSlug, setDrawerSlug] = useState<string | null>(null)
```

  Add `onEditAgent` to `buildData`'s returned object (and to its dep array nothing new needed — `setDrawerSlug` is stable):

```ts
    onChange: patch => updateNode(node.id, patch),
    onEditAgent: (s: string) => setDrawerSlug(s),
```

  Render the drawer inside the canvas's relative wrapper — change the `<div className="flex-1 min-w-0 relative">` block so it also renders the drawer:

```tsx
        <div className="flex-1 min-w-0 relative">
          <ChainCanvas
            /* …existing props… */
          />
          {drawerSlug && (
            <AgentDrawer
              slug={drawerSlug}
              agentName={agents.find(a => a.slug === drawerSlug)?.name ?? drawerSlug}
              onClose={() => setDrawerSlug(null)}
              onSaved={refetchAgents}
            />
          )}
        </div>
```

- [ ] **Step 5: Provide `refetchAgents` from the workspace page.** In `app/workspace/page.tsx`:

  Add `useCallback` to the React import. Replace the agents/context `useEffect` (currently lines ~64-70) with a memoized fetch + an effect that calls it:

```ts
  const refetchEditorData = useCallback(() => {
    fetch('/api/workspace')
      .then(r => r.json())
      .then(w => { setEditorAgents(w.agents ?? []); setEditorContext(w.context ?? []) })
      .catch(() => { setEditorAgents([]); setEditorContext([]) })
  }, [])

  useEffect(() => {
    if (type !== 'chain') return
    refetchEditorData()
  }, [type, slug, refetchEditorData])
```

  Pass it to the editor — in the `<ChainEditor … />` JSX add:

```tsx
                      refetchAgents={refetchEditorData}
```

- [ ] **Step 6: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 7: Manual verification**

Run: `npm run dev`, open a chain with an agent node, then:
- Click **Edit agent →** on an agent node → the drawer opens on the right showing that agent's full `.md`.
- Edit the system prompt; the drawer's status reaches `saved` within ~2s; opening the same agent on its own tab shows the change.
- If you change the agent's `outputs` frontmatter, after save the node's output sockets update on the canvas (driven by `refetchAgents`).
- **Open full file →** navigates to the agent's tab. Close (✕) hides the drawer.

- [ ] **Step 8: Commit**

```bash
git add components/editor/AgentDrawer.tsx components/editor/nodeData.ts components/editor/nodes/AgentNode.tsx components/editor/ChainEditor.tsx app/workspace/page.tsx
git commit -m "feat: inline agent prompt editing via a side drawer in the chain editor"
```

---

## Task 4: Fork-from-template builder (§2.9 core, TDD)

Pure logic that turns a `TemplateDef` into the data for a new chain by deep-copying its referenced chain's graph. Also exports `chainToData` so the API can persist it through the standard save path.

**Files:**
- Modify: `lib/serializeChain.ts`
- Create: `lib/fs/forkChain.ts`
- Test: `tests/fork-chain.test.ts`

**Interfaces:**
- Consumes: `ChainDef`, `ChainNode`, `ChainEdge`, `TemplateDef` from `lib/types.ts`.
- Produces:
  - `chainToData(meta: { name: string; description?: string }, nodes: ChainNode[], edges: ChainEdge[]): Record<string, unknown>` (exported from `lib/serializeChain.ts`).
  - `interface ForkedChain { slug: string; name: string; description: string; nodes: ChainNode[]; edges: ChainEdge[] }`
  - `buildChainFromTemplate(template: TemplateDef, newName: string, chains: ChainDef[]): ForkedChain`

- [ ] **Step 1: Extract `chainToData`.** In `lib/serializeChain.ts`, replace the `serializeChain` function with:

```ts
export function chainToData(
  meta: { name: string; description?: string },
  nodes: ChainNode[],
  edges: ChainEdge[],
): Record<string, unknown> {
  return {
    name: meta.name,
    description: meta.description ?? '',
    nodes: nodes.map(serializeNode),
    edges: edges.map(serializeEdge),
  }
}

export function serializeChain(
  meta: { name: string; description?: string },
  nodes: ChainNode[],
  edges: ChainEdge[],
): string {
  return matter.stringify('', chainToData(meta, nodes, edges))
}
```

- [ ] **Step 2: Write the failing tests.** New file `tests/fork-chain.test.ts`:

```ts
import assert from 'node:assert'
import { buildChainFromTemplate } from '../lib/fs/forkChain'
import { ChainDef, TemplateDef } from '../lib/types'

const refChain: ChainDef = {
  slug: 'triage', name: 'Triage', description: '', filePath: '',
  nodes: [{ id: 'seed', kind: 'seed' }, { id: 'a', kind: 'agent', agent: 'x' }],
  edges: [{ fromNode: 'seed', fromSocket: 'output', toNode: 'a', toSocket: 'input' }],
}
const tmpl: TemplateDef = { slug: 't1', name: 'My Template', description: '', chain: 'triage', seedPrompt: 'go', filePath: '' }

// copies the referenced chain's graph, derives a kebab slug from the new name
const forked = buildChainFromTemplate(tmpl, 'New Flow', [refChain])
assert.strictEqual(forked.slug, 'new-flow')
assert.strictEqual(forked.nodes.length, 2)
assert.strictEqual(forked.edges.length, 1)
assert.strictEqual(forked.nodes[1].agent, 'x')

// the copy is independent of the source chain
forked.nodes[0].id = 'changed'
assert.strictEqual(refChain.nodes[0].id, 'seed')

// empty/missing ref -> empty graph + fallback description
const blank = buildChainFromTemplate({ ...tmpl, chain: '' }, 'Blank', [refChain])
assert.strictEqual(blank.nodes.length, 0)
assert.strictEqual(blank.edges.length, 0)
assert.match(blank.description, /A new chain named Blank/)

console.log('✅ fork-chain tests passed')
```

- [ ] **Step 3: Run to verify failure**

Run: `npx tsx tests/fork-chain.test.ts`
Expected: FAIL — cannot find module `../lib/fs/forkChain`.

- [ ] **Step 4: Implement the builder.** New file `lib/fs/forkChain.ts`:

```ts
import { ChainDef, ChainNode, ChainEdge, TemplateDef } from '../types'

function toSlug(name: string): string {
  return name.toLowerCase().trim().replace(/\s+/g, '-').replace(/[^\w.-]/g, '')
}

export interface ForkedChain {
  slug: string
  name: string
  description: string
  nodes: ChainNode[]
  edges: ChainEdge[]
}

// Build the data for a new chain by deep-copying the template's referenced chain graph.
// If the template has no resolvable chain ref, produce an empty chain.
export function buildChainFromTemplate(
  template: TemplateDef,
  newName: string,
  chains: ChainDef[],
): ForkedChain {
  const ref = template.chain ? chains.find(c => c.slug === template.chain) : undefined
  return {
    slug: toSlug(newName),
    name: newName,
    description: ref ? `Forked from template "${template.name}"` : `A new chain named ${newName}`,
    nodes: ref ? ref.nodes.map(n => structuredClone(n)) : [],
    edges: ref ? ref.edges.map(e => ({ ...e })) : [],
  }
}
```

- [ ] **Step 5: Run to verify the suite passes**

Run: `npx tsx tests/fork-chain.test.ts && npx tsx tests/serialize-chain.test.ts`
Expected: both PASS (`✅ fork-chain tests passed`, and the existing serialize round-trip still passes after the `chainToData` extraction).

- [ ] **Step 6: Commit**

```bash
git add lib/serializeChain.ts lib/fs/forkChain.ts tests/fork-chain.test.ts
git commit -m "feat: buildChainFromTemplate + export chainToData for template forking"
```

---

## Task 5: Fork API + creation UI + seed prefill (§2.9 wiring)

Wire the builder into the creation endpoint and the Sidebar's chain-creation modal, and prefill the template's seed prompt in the opened editor.

**Files:**
- Modify: `app/api/workspace/route.ts`
- Modify: `components/workspace/Sidebar.tsx`
- Modify: `app/workspace/page.tsx`
- Modify: `components/editor/ChainEditor.tsx`

**Interfaces:**
- Consumes: `buildChainFromTemplate` (Task 4), `chainToData` (Task 4), `loadWorkspace()`, `resolveEntityPath`, `saveWorkspaceEntity`.
- Produces: `POST /api/workspace` accepts optional `fromTemplate: string` and, on the fork path, returns `{ success, filePath, slug, seedPrompt }`; `ChainEditor` accepts optional `initialSeedPrompt?: string`.

- [ ] **Step 1: Read the Next.js route-handler guide** (per Global Constraints).

Read `.agents/skills/nextjs16.md` (route handlers / caching / async request APIs), then `node_modules/next/dist/docs/` for anything uncovered. Confirm the `POST` signature and `NextResponse` helpers used below match this repo's Next version — note the existing `POST /api/workspace` reads its body with `await request.json()` (request methods are fine; only `params`/`searchParams`/`cookies()`/`headers()` are async).

- [ ] **Step 2: Extend the creation endpoint.** In `app/api/workspace/route.ts`:

  Add imports:

```ts
import { loadWorkspace, resolveEntityPath, sanitizeSlug, isValidEntityType } from '@/lib/fs/workspace'
import { createWorkspaceEntity, saveWorkspaceEntity } from '@/lib/fs/save'
import { buildChainFromTemplate } from '@/lib/fs/forkChain'
import { chainToData } from '@/lib/serializeChain'
```

  In `POST`, destructure `fromTemplate` and add the fork branch *before* the existing `createWorkspaceEntity` call:

```ts
    const body = await request.json()
    const { type, name, slug, fromTemplate } = body

    if (!type || !name) {
      return NextResponse.json({ error: 'Missing type or name' }, { status: 400 })
    }
    if (!isValidEntityType(type)) {
      return NextResponse.json({ error: 'Invalid type' }, { status: 400 })
    }

    if (type === 'chain' && fromTemplate) {
      const { templates, chains } = loadWorkspace()
      const tmpl = templates.find(t => t.slug === fromTemplate)
      if (!tmpl) {
        return NextResponse.json({ error: 'Template not found' }, { status: 404 })
      }
      const forked = buildChainFromTemplate(tmpl, name, chains)
      const forkPath = resolveEntityPath('chain', forked.slug)
      if (fs.existsSync(forkPath)) {
        return NextResponse.json({ error: 'Entity already exists' }, { status: 409 })
      }
      const data = chainToData({ name: forked.name, description: forked.description }, forked.nodes, forked.edges)
      const result = saveWorkspaceEntity({ type: 'chain', slug: forked.slug, data, content: '' })
      return NextResponse.json({ success: true, ...result, seedPrompt: tmpl.seedPrompt })
    }

    const cleanSlug = sanitizeSlug(slug || name.toLowerCase().replace(/\s+/g, '-'))
    const filePath = resolveEntityPath(type, cleanSlug)
    if (fs.existsSync(filePath)) {
      return NextResponse.json({ error: 'Entity already exists' }, { status: 409 })
    }
    const result = createWorkspaceEntity({ type, name, slug: cleanSlug })
    return NextResponse.json({ success: true, ...result })
```

- [ ] **Step 3: Add `initialSeedPrompt` to `ChainEditor`.** In `components/editor/ChainEditor.tsx`, accept the prop and seed the state from it:

```ts
export default function ChainEditor({ slug, initialChain, agents, contextFiles, refetchAgents, initialSeedPrompt }: {
  slug: string
  initialChain: ChainDef
  agents: AgentDef[]
  contextFiles: { slug: string; name: string }[]
  refetchAgents?: () => void
  initialSeedPrompt?: string
}) {
```

```ts
  const [seedPrompt, setSeedPrompt] = useState(initialSeedPrompt ?? '')
```

- [ ] **Step 4: Read the `seed` query param in the workspace page.** In `app/workspace/page.tsx`, add near the other `searchParams` reads:

```ts
  const seedParam = searchParams.get('seed') ?? undefined
```

  Pass it to the editor JSX:

```tsx
                      initialSeedPrompt={seedParam}
```

- [ ] **Step 5: Add the template picker to the creation modal.** In `components/workspace/Sidebar.tsx`:

  Add state next to `newName`:

```ts
  const [fromTemplate, setFromTemplate] = useState<string>('')
```

  In `handleCreate`, include `fromTemplate` in the POST body and route with the returned seed. Replace the `fetch('/api/workspace', …)` body and the success navigation:

```ts
      const res = await fetch('/api/workspace', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          type: modalType,
          name: newName,
          ...(modalType === 'chain' && fromTemplate ? { fromTemplate } : {}),
        }),
      })
```

```ts
      // Close modal and redirect (graph mode is the chain editor default)
      setIsModalOpen(false)
      setNewName('')
      setFromTemplate('')
      handleSelect(modalType, result.slug, result.seedPrompt)
```

  Update `handleSelect` to accept an optional seed and put it on the URL:

```ts
  const handleSelect = (type: string, slug: string, seed?: string) => {
    const params = new URLSearchParams(searchParams.toString());
    params.set('type', type);
    params.set('slug', slug);
    if (seed) params.set('seed', seed); else params.delete('seed');
    // …unchanged tabs handling…
    router.push(`/workspace?${params.toString()}`);
  };
```

  In the creation modal `<form>`, render the picker only for chains — add right after the Name field's closing `</div>`:

```tsx
              {modalType === 'chain' && data.templates.length > 0 && (
                <div className="mb-4">
                  <label className="block text-sm font-medium text-zinc-700 mb-1">
                    From template <span className="text-zinc-400 font-normal">(optional)</span>
                  </label>
                  <select
                    value={fromTemplate}
                    onChange={(e) => setFromTemplate(e.target.value)}
                    className="w-full px-3 py-2 border border-zinc-300 rounded-md focus:outline-none focus:ring-2 focus:ring-zinc-500"
                    disabled={isCreating}
                  >
                    <option value="">Empty chain</option>
                    {data.templates.map(t => (
                      <option key={t.slug} value={t.slug}>{t.name}</option>
                    ))}
                  </select>
                </div>
              )}
```

  Also clear `fromTemplate` in the modal's Cancel handler (`onClick` of the Cancel button): add `setFromTemplate('')`.

- [ ] **Step 6: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 7: Manual verification**

Run: `npm run dev`. Ensure a template exists whose `chain:` frontmatter references a non-empty chain. Then:
- Sidebar → Chains → **+** → modal shows a **From template** dropdown. Pick the template, enter a name, Create.
- The new chain opens in **Graph** mode pre-populated with a copy of the referenced chain's nodes/edges; the seed-prompt field is prefilled with the template's seed.
- The original referenced chain is unchanged. Creating with **Empty chain** selected yields a blank graph (existing behavior).
- Creating a name that already exists surfaces the "Entity already exists" toast (409).

- [ ] **Step 8: Commit**

```bash
git add app/api/workspace/route.ts components/workspace/Sidebar.tsx app/workspace/page.tsx components/editor/ChainEditor.tsx
git commit -m "feat: author a new chain from a template (fork graph + seed prefill)"
```

---

## Self-Review

**Spec coverage (Group A of the design doc):**
- §2.5 multi-select + copy/paste → Tasks 1–2 (ops + wiring; group-drag persistence; key bindings; in-memory clipboard; fresh-zone remap). ✓
- §2.7 inline agent prompt editing → Task 3 (drawer reuses `FileEditor` + `useAutoSave`; "Open full file" link; `refetchAgents` refreshes sockets). ✓
- §2.9 author from template → Tasks 4–5 (pure fork builder; `fromTemplate` endpoint branch; creation-modal picker; seed prefill; empty-ref fallback). ✓
- Primary-selection rule (`selectedIds[0]`) honored in preview/validation/drawer. ✓

**Placeholder scan:** No TBD/TODO; every code step shows complete code; manual-verification steps list concrete expected outcomes. ✓

**Type consistency:** `Subgraph`, `copySubgraph`, `pasteSubgraph`, `buildChainFromTemplate`, `ForkedChain`, `chainToData`, `EditorNodeData.onEditAgent`, `ChainEditor` props (`refetchAgents`, `initialSeedPrompt`), and `ChainCanvas` props (`selectedIds`, `onSelectionChange`, `onMoveMany`) are named identically across the tasks that define and consume them. ✓

**Out of scope (deferred per design):** whole-zone auto-expansion on partial-zone copy; system/cross-tab clipboard. The §1.2 reducer (Group B) will absorb `selectedIds`/`clipboard` — noted, not done here.
