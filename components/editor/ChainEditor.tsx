'use client'
import React, { useCallback, useEffect, useMemo, useRef, useState, useReducer } from 'react'
import dagre from 'dagre'
import { useEditedFile } from '@/hooks/useEditedFile'
import { serializeChain } from '@/lib/serializeChain'
import { validateChain, issuesByNode } from '@/lib/chainGraph'
import { socketHandles } from '@/lib/nodeSockets'
import { uniqueNodeId, applyOp, editorOps, NON_HISTORIC, type EditorOp, type EditorGraph } from '@/lib/editorOps'
import { withHistory, canUndo, canRedo } from '@/lib/history'
import { upstreamSubgraph } from '@/lib/partialRun'
import { computeZoneFrames, zoneAtPoint } from '@/lib/zoneFrames'
import type { ChainDef, ChainNode, ChainEdge, AgentDef, ChainNodeKind, ChainPort, ToolDef, SkillDef, ValidationIssue } from '@/lib/types'
import type { RunStateMap } from '@/lib/runState'
import type { EditorNodeData } from './nodeData'
import ChainCanvas from './ChainCanvas'
import NodePalette from './NodePalette'
import AgentDrawer from './AgentDrawer'
import { useRunStore, setRunTarget, clearRunTarget } from '@/hooks/store/useRunStore'
import { useSelectionStore } from '@/hooks/store/useSelectionStore'
import { useWorkspaceStore } from '@/hooks/store/useWorkspaceStore'
import { parseChainContent } from '@/lib/parseChain'
import ExternalChangeBanner from '@/components/workspace/ExternalChangeBanner'
import { Play } from 'lucide-react'
import InterfacePopover from './InterfacePopover'
import { Group, Panel, Separator } from 'react-resizable-panels'

const NODE_W = 240, NODE_H = 120

// Stable empty reference: a zustand v5 selector must return a cached value, never a fresh
// `{}` each call, or useSyncExternalStore reports "getSnapshot should be cached" and loops.
const EMPTY_RUN_STATE: RunStateMap = {}

function seedPositions(nodes: ChainNode[], edges: ChainEdge[]): ChainNode[] {
  if (nodes.every(n => n.pos)) return nodes
  const g = new dagre.graphlib.Graph()
  g.setDefaultEdgeLabel(() => ({}))
  g.setGraph({ rankdir: 'LR', nodesep: 40, ranksep: 90 })
  nodes.forEach(n => g.setNode(n.id, { width: NODE_W, height: NODE_H }))
  edges.forEach(e => g.setEdge(e.fromNode, e.toNode))
  dagre.layout(g)
  return nodes.map(n => n.pos ? n : { ...n, pos: [g.node(n.id).x - NODE_W / 2, g.node(n.id).y - NODE_H / 2] as [number, number] })
}

export default function ChainEditor({ slug, initialChain, agents, contextFiles, initialSeedPrompt, chains, tools, skills, onValidation }: {
  slug: string
  initialChain: ChainDef
  agents: AgentDef[]
  contextFiles: { slug: string; name: string }[]
  initialSeedPrompt?: string
  chains: ChainDef[]
  tools?: ToolDef[]
  skills?: SkillDef[]
  onValidation?: (issues: ValidationIssue[]) => void
}) {
  const historied = useMemo(() => withHistory(applyOp, (op: EditorOp) => !NON_HISTORIC.has(op.type)), [])
  const [hist, dispatch] = useReducer(historied, undefined, () => ({
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
  // Canonical per-file store key — must match page.tsx `currentFileKey` (`${type}:${slug}`)
  // and DockPanel/OutputTab so the merged panel reads the same run/selection slice.
  const fileKey = `chain:${slug}`

  const setSelectedIds = useCallback((ids: string[]) => {
    dispatch(editorOps.setSelection(ids))
    useSelectionStore.getState().setSelected(fileKey, ids[0] ?? null)
  }, [fileKey])
  const [drawerSlug, setDrawerSlug] = useState<string | null>(null)
  const { content, setContent, conflict, resolve, externalRevision } = useEditedFile('chain', slug)

  const [iface, setIface] = useState<{ inputs: ChainPort[]; outputs: ChainPort[] }>(() => ({
    inputs: initialChain.inputs ?? [],
    outputs: initialChain.outputs ?? [],
  }))

  // False until the graph has rendered what it is about to write, so opening a
  // hand-written file does not immediately save the graph's own serialisation (#121).
  const hasRendered = useRef(false)

  // A change adopted from disk re-seeds the graph in place rather than remounting it, so
  // the undo stack and the viewport survive it — `setGraph` is NON_HISTORIC, so the seed
  // replaces the present without landing on the stack. Adjusting state during render is
  // React's own answer to "an input changed"; an effect here would re-render twice (#121).
  const [seededAt, setSeededAt] = useState(externalRevision)
  if (seededAt !== externalRevision) {
    setSeededAt(externalRevision)
    try {
      const parsed = parseChainContent(content, slug)
      dispatch(editorOps.setGraph(seedPositions(parsed.nodes, parsed.edges), parsed.edges))
      setIface({ inputs: parsed.inputs ?? [], outputs: parsed.outputs ?? [] })
    } catch {
      // an unparseable file on disk leaves the graph as it is; the YAML view shows why
    }
  }

  const runState = useRunStore(state => {
    const f = state.byFile[fileKey]
    if (!f) return EMPTY_RUN_STATE
    return f.runState[f.currentInstance] ?? EMPTY_RUN_STATE
  })
  const seedPrompt = useRunStore(state => state.byFile[fileKey]?.seedPrompt ?? '')
  const running = useRunStore(state => state.byFile[fileKey]?.running ?? false)
  const setSeed = useRunStore(state => state.setSeed)
  const triggerRun = useRunStore(state => state.run)
  const currentInstance = useRunStore(state => state.byFile[fileKey]?.currentInstance ?? 0)
  const instanceCount = useRunStore(state => state.byFile[fileKey]?.instanceCount ?? 0)

  const chain: ChainDef = useMemo(() => ({
    ...initialChain,
    inputs: iface.inputs,
    outputs: iface.outputs,
    nodes,
    edges,
  }), [initialChain, iface, nodes, edges])

  useEffect(() => {
    if (!hasRendered.current) { hasRendered.current = true; return }
    setContent(serializeChain(chain))
  }, [chain, setContent])

  const validation = useMemo(() => validateChain(chain, { agents, chains, tools, skills }), [chain, agents, chains, tools, skills])

  const nodeIssues = useMemo(() => issuesByNode(validation.issues), [validation])
  useEffect(() => { onValidation?.(validation.issues) }, [validation, onValidation])
  useEffect(() => () => onValidation?.([]), [onValidation])

  useEffect(() => {
    if (initialSeedPrompt !== undefined) {
      useRunStore.getState().setSeed(fileKey, initialSeedPrompt)
    }
  }, [fileKey, initialSeedPrompt])

  useEffect(() => {
    setRunTarget(fileKey, {
      type: 'chain',
      slug,
      buildBody: (seed) => ({
        chain: { ...chain, inputs: iface.inputs, outputs: iface.outputs, nodes, edges },
        seedPrompt: seed,
        type: 'chain',
        slug,
      }),
    })
    return () => {
      clearRunTarget(fileKey)
    }
  }, [fileKey, slug, chain, iface, nodes, edges])

  const run = useCallback(() => triggerRun(fileKey), [triggerRun, fileKey])

  const runUpTo = useCallback((targetId: string) => {
    const sub = upstreamSubgraph(chain, targetId)
    // Partial "run from here" is single-instance (design §2) — never fan out.
    return triggerRun(fileKey, {
      parallel: 1,
      bodyOverride: (seed) => ({
        chain: {
          ...chain,
          inputs: iface.inputs,
          outputs: iface.outputs,
          nodes: sub.nodes,
          edges: sub.edges,
        },
        seedPrompt: seed,
        type: 'chain',
        slug,
      }),
    })
  }, [triggerRun, fileKey, slug, chain, iface])

  const updateNode = useCallback((id: string, patch: Partial<ChainNode>) => dispatch(editorOps.updateNode(id, patch)), [])
  const moveNode = useCallback((id: string, pos: [number, number]) => {
    const node = nodes.find(n => n.id === id)
    if (!node || node.kind === 'loop-start' || node.kind === 'loop-end') {
      dispatch(editorOps.moveNode(id, pos)); return
    }
    const frames = computeZoneFrames(nodes.filter(n => n.id !== id))
    const zone = zoneAtPoint(frames, pos[0] + NODE_W / 2, pos[1] + NODE_H / 2)
    dispatch(editorOps.updateNode(id, { pos, zone }))
  }, [nodes])
  const moveMany = useCallback((updates: { id: string; pos: [number, number] }[]) => dispatch(editorOps.moveMany(updates)), [])
  const addNodeOfKind = useCallback((kind: ChainNodeKind, pos: [number, number] = [80, 80], extra?: Partial<ChainNode>) => {
    dispatch(editorOps.addNode({
      id: uniqueNodeId(kind, nodes.map(n => n.id)),
      kind,
      pos,
      ...extra,
    }))
  }, [nodes])
  const addLoopZone = useCallback((pos: [number, number] = [120, 120]) => dispatch(editorOps.addLoopZone(pos)), [])
  const connect = useCallback((edge: ChainEdge) => dispatch(editorOps.connect(edge)), [])
  const deleteNode = useCallback((id: string) => dispatch(editorOps.deleteNode(id)), [])
  const deleteEdge = useCallback((edge: ChainEdge) => dispatch(editorOps.deleteEdge(edge)), [])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return
      if (!(e.metaKey || e.ctrlKey)) return
      const key = e.key.toLowerCase()
      if (key === 'c' && selectedIds.length) {
        if (window.getSelection()?.toString()) return
        e.preventDefault()
        dispatch(editorOps.copy(selectedIds))
      } else if (key === 'v' && clipboard) {
        e.preventDefault()
        dispatch(editorOps.paste())
      } else if (key === 'd' && selectedIds.length) {
        e.preventDefault()
        dispatch(editorOps.copy(selectedIds))
        dispatch(editorOps.paste())
      } else if (key === 'z' && !e.shiftKey) {
        e.preventDefault()
        dispatch(editorOps.undo())
      } else if (key === 'y' || (key === 'z' && e.shiftKey)) {
        e.preventDefault()
        dispatch(editorOps.redo())
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [selectedIds, clipboard])

  const buildData = useCallback((node: ChainNode): EditorNodeData => ({
    node,
    sockets: socketHandles(node, { chain, agents, chains }),
    agents: agents.map(a => ({ slug: a.slug, name: a.name })),
    contextFiles,
    run: runState[node.id],
    issues: nodeIssues.get(node.id) ?? [],
    onChange: patch => updateNode(node.id, patch),
    onEditAgent: (s: string) => setDrawerSlug(s),
    onRunFromHere: (id: string) => { setSelectedIds([id]); runUpTo(id) },
    chains: chains.map(c => ({ slug: c.slug, name: c.name })),
    wiredSockets: new Set(edges.filter(e => e.toNode === node.id).map(e => e.toSocket)),
  }), [chain, agents, contextFiles, runState, nodeIssues, updateNode, runUpTo, chains, setSelectedIds, edges])

  return (
    <div className="h-full flex flex-col">
      <ExternalChangeBanner conflict={conflict} resolve={resolve} />

      <div className="px-4 py-1 border-b border-zinc-100 flex items-center justify-end bg-white">
        <InterfacePopover nodes={nodes} inputs={iface.inputs} outputs={iface.outputs} onChange={setIface} />
      </div>

      <div className="flex-1 min-h-0 flex">
        <NodePalette onAdd={addNodeOfKind} onAddLoopZone={addLoopZone} />
        <div className="flex-1 min-w-0 relative">
          {drawerSlug ? (
            <Group orientation="horizontal" className="absolute inset-0">
              <Panel minSize="30%">
                <ChainCanvas
                  nodes={nodes}
                  edges={edges}
                  buildData={buildData}
                  selectedIds={selectedIds}
                  onSelectionChange={setSelectedIds}
                  onMove={moveNode}
                  onMoveMany={moveMany}
                  onConnect={connect}
                  onDeleteNode={deleteNode}
                  onDeleteEdge={deleteEdge}
                  instanceCount={instanceCount}
                  currentInstance={currentInstance}
                  onInstance={(i) => useRunStore.getState().setCurrentInstance(fileKey, i)}
                  onAddNode={addNodeOfKind}
                  onAddLoopZone={addLoopZone}
                  agents={agents}
                  contextFiles={contextFiles}
                />
              </Panel>
              <Separator className="w-1 border-x border-zinc-200 bg-zinc-100 hover:bg-zinc-200 transition-colors" />
              <Panel defaultSize="45%" minSize="20%" maxSize="80%">
                <AgentDrawer
                  slug={drawerSlug}
                  agentName={agents.find(a => a.slug === drawerSlug)?.name ?? drawerSlug}
                  skills={skills}
                  onClose={() => setDrawerSlug(null)}
                  onSaved={() => useWorkspaceStore.getState().load()}
                />
              </Panel>
            </Group>
          ) : (
            <ChainCanvas
              nodes={nodes}
              edges={edges}
              buildData={buildData}
              selectedIds={selectedIds}
              onSelectionChange={setSelectedIds}
              onMove={moveNode}
              onMoveMany={moveMany}
              onConnect={connect}
              onDeleteNode={deleteNode}
              onDeleteEdge={deleteEdge}
              instanceCount={instanceCount}
              currentInstance={currentInstance}
              onInstance={(i) => useRunStore.getState().setCurrentInstance(fileKey, i)}
              onAddNode={addNodeOfKind}
              onAddLoopZone={addLoopZone}
              agents={agents}
              contextFiles={contextFiles}
            />
          )}
        </div>
      </div>
    </div>
  )
}
