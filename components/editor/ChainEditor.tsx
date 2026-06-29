'use client'
import React, { useCallback, useEffect, useMemo, useState, useReducer } from 'react'
import dagre from 'dagre'
import { useAutoSave } from '@/hooks/useAutoSave'
import { serializeChain } from '@/lib/serializeChain'
import { validateChain } from '@/lib/chainGraph'
import { inputSocketsOf, outputSocketsOf } from '@/lib/nodeSockets'
import { uniqueNodeId } from '@/lib/editorOps'
import { applyEditorAction, EditorAction, NON_HISTORIC } from '@/lib/editorReducer'
import { withHistory, canUndo, canRedo } from '@/lib/history'
import { upstreamSubgraph } from '@/lib/partialRun'
import { computeZoneFrames, zoneAtPoint } from '@/lib/zoneFrames'
import type { ChainDef, ChainNode, ChainEdge, AgentDef, ChainNodeKind, ChainPort } from '@/lib/types'
import type { EditorNodeData } from './nodeData'
import ChainCanvas from './ChainCanvas'
import NodePalette from './NodePalette'
import AgentDrawer from './AgentDrawer'
import { useRunStore, setRunTarget, clearRunTarget } from '@/hooks/store/useRunStore'
import { useSelectionStore } from '@/hooks/store/useSelectionStore'
import { parseChainContent } from '@/lib/parseChain'
import { reconcileExternalEdit } from '@/lib/syncReconcile'
import { useFileWatch } from '@/hooks/useFileWatch'
import { Play } from 'lucide-react'

const NODE_W = 240, NODE_H = 120

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

export default function ChainEditor({ slug, initialChain, agents, contextFiles, refetchAgents, initialSeedPrompt, chains }: {
  slug: string
  initialChain: ChainDef
  agents: AgentDef[]
  contextFiles: { slug: string; name: string }[]
  refetchAgents?: () => void
  initialSeedPrompt?: string
  chains: ChainDef[]
}) {
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

  const setSelectedIds = useCallback((ids: string[]) => {
    dispatch({ type: 'setSelection', ids })
    useSelectionStore.getState().setSelected(slug, ids[0] ?? null)
  }, [slug])
  const [drawerSlug, setDrawerSlug] = useState<string | null>(null)
  const meta = useMemo(() => ({ name: initialChain.name, description: initialChain.description }), [initialChain])

  const initialMarkdown = useMemo(() => serializeChain({ name: initialChain.name, description: initialChain.description, inputs: initialChain.inputs, outputs: initialChain.outputs }, seedPositions(initialChain.nodes, initialChain.edges), initialChain.edges), [initialChain])
  const { setContent, status, content, getLastSaved } = useAutoSave('chain', slug, initialMarkdown)

  const [iface, setIface] = useState<{ inputs: ChainPort[]; outputs: ChainPort[] }>(() => ({
    inputs: initialChain.inputs ?? [],
    outputs: initialChain.outputs ?? [],
  }))

  const incoming = useFileWatch('chain', slug)
  const [conflict, setConflict] = useState<string | null>(null)

  const adopt = useCallback((raw: string) => {
    const parsed = parseChainContent(raw, slug)
    dispatch({ type: 'setGraph', nodes: seedPositions(parsed.nodes, parsed.edges), edges: parsed.edges })
    setIface({ inputs: parsed.inputs ?? [], outputs: parsed.outputs ?? [] })
  }, [slug])

  useEffect(() => {
    if (incoming == null) return
    const decision = reconcileExternalEdit({ local: content, lastSaved: getLastSaved(), incoming })
    if (decision === 'adopt') adopt(incoming)
    else if (decision === 'conflict') setConflict(incoming)
  }, [incoming]) // eslint-disable-line react-hooks/exhaustive-deps

  const runState = useRunStore(state => {
    const f = state.byFile[slug]
    if (!f) return {}
    return f.runState[f.currentInstance] ?? {}
  })
  const seedPrompt = useRunStore(state => state.byFile[slug]?.seedPrompt ?? '')
  const running = useRunStore(state => state.byFile[slug]?.running ?? false)
  const setSeed = useRunStore(state => state.setSeed)
  const triggerRun = useRunStore(state => state.run)
  const currentInstance = useRunStore(state => state.byFile[slug]?.currentInstance ?? 0)
  const instanceCount = useRunStore(state => state.byFile[slug]?.instanceCount ?? 0)

  // Push every graph change into the autosave pipeline as serialized markdown.
  useEffect(() => {
    setContent(serializeChain({ name: meta.name, description: meta.description, inputs: iface.inputs, outputs: iface.outputs }, nodes, edges))
  }, [meta, nodes, edges, iface, setContent])

  const chain: ChainDef = useMemo(() => ({ ...initialChain, nodes, edges }), [initialChain, nodes, edges])
  const validation = useMemo(() => validateChain(chain, agents, chains), [chain, agents, chains])

  const issuesByNode = useMemo(() => {
    const m = new Map<string, string[]>()
    for (const i of validation.issues) {
      const id = i.nodeId ?? i.edge?.toNode
      if (!id) continue
      m.set(id, [...(m.get(id) ?? []), i.message])
    }
    return m
  }, [validation])

  useEffect(() => {
    if (initialSeedPrompt !== undefined) {
      useRunStore.getState().setSeed(slug, initialSeedPrompt)
    }
  }, [slug, initialSeedPrompt])

  useEffect(() => {
    setRunTarget(slug, {
      type: 'chain',
      slug,
      buildBody: (seed) => ({
        chain: {
          name: meta.name,
          description: meta.description,
          inputs: iface.inputs,
          outputs: iface.outputs,
          nodes,
          edges,
        },
        seedPrompt: seed,
        type: 'chain',
        slug,
      }),
    })
    return () => {
      clearRunTarget(slug)
    }
  }, [slug, meta, iface, nodes, edges])

  const run = useCallback(() => triggerRun(slug), [triggerRun, slug])

  const runUpTo = useCallback((targetId: string) => {
    const sub = upstreamSubgraph({ ...initialChain, nodes, edges }, targetId)
    return triggerRun(slug, {
      bodyOverride: (seed) => ({
        chain: {
          name: meta.name,
          description: meta.description,
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
  }, [triggerRun, slug, initialChain, nodes, edges, meta, iface])

  const updateNode = useCallback((id: string, patch: Partial<ChainNode>) => dispatch({ type: 'updateNode', id, patch }), [])
  const moveNode = useCallback((id: string, pos: [number, number]) => {
    const node = nodes.find(n => n.id === id)
    if (!node || node.kind === 'loop-start' || node.kind === 'loop-end') {
      dispatch({ type: 'moveNode', id, pos }); return
    }
    const frames = computeZoneFrames(nodes.filter(n => n.id !== id))
    const zone = zoneAtPoint(frames, pos[0] + NODE_W / 2, pos[1] + NODE_H / 2)
    dispatch({ type: 'updateNode', id, patch: { pos, zone } })
  }, [nodes])
  const moveMany = useCallback((updates: { id: string; pos: [number, number] }[]) => dispatch({ type: 'moveMany', updates }), [])
  const addNodeOfKind = useCallback((kind: ChainNodeKind) => dispatch({ type: 'addNode', node: { id: uniqueNodeId(kind, nodes.map(n => n.id)), kind, pos: [80, 80] } }), [nodes])
  const addLoopZone = useCallback(() => dispatch({ type: 'addLoopZone', pos: [120, 120] }), [])
  const connect = useCallback((edge: ChainEdge) => dispatch({ type: 'connect', edge }), [])
  const deleteNode = useCallback((id: string) => dispatch({ type: 'deleteNode', id }), [])
  const deleteEdge = useCallback((edge: ChainEdge) => dispatch({ type: 'deleteEdge', edge }), [])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return
      if (!(e.metaKey || e.ctrlKey)) return
      const key = e.key.toLowerCase()
      if (key === 'c' && selectedIds.length) {
        if (window.getSelection()?.toString()) return
        e.preventDefault()
        dispatch({ type: 'copy', ids: selectedIds })
      } else if (key === 'v' && clipboard) {
        e.preventDefault()
        dispatch({ type: 'paste' })
      } else if (key === 'd' && selectedIds.length) {
        e.preventDefault()
        dispatch({ type: 'copy', ids: selectedIds })
        dispatch({ type: 'paste' })
      } else if (key === 'z' && !e.shiftKey) {
        e.preventDefault()
        dispatch({ type: 'undo' })
      } else if (key === 'y' || (key === 'z' && e.shiftKey)) {
        e.preventDefault()
        dispatch({ type: 'redo' })
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [selectedIds, clipboard])

  const buildData = useCallback((node: ChainNode): EditorNodeData => ({
    node,
    inputs: inputSocketsOf(node, chain, agents, chains),
    outputs: outputSocketsOf(node, chain, agents, chains),
    agents: agents.map(a => ({ slug: a.slug, name: a.name })),
    contextFiles,
    run: runState[node.id],
    issues: issuesByNode.get(node.id) ?? [],
    onChange: patch => updateNode(node.id, patch),
    onEditAgent: (s: string) => setDrawerSlug(s),
    onRunFromHere: (id: string) => { setSelectedIds([id]); runUpTo(id) },
    chains: chains.map(c => ({ slug: c.slug, name: c.name })),
  }), [chain, agents, contextFiles, runState, issuesByNode, updateNode, runUpTo, chains, setSelectedIds])

  return (
    <div className="h-full flex flex-col">
      {conflict && (
        <div className="px-4 py-1.5 text-[11px] text-amber-700 bg-amber-50 border-b border-amber-100 flex items-center gap-3">
          <span>This chain changed on disk.</span>
          <button className="font-bold underline" onClick={() => { adopt(conflict); setConflict(null) }}>Reload from disk</button>
          <button className="font-bold underline" onClick={() => setConflict(null)}>Keep my version</button>
        </div>
      )}

      <div className="flex-1 min-h-0 flex">
        <NodePalette onAdd={addNodeOfKind} onAddLoopZone={addLoopZone} />
        <div className="flex-1 min-w-0 relative">
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
            onInstance={(i) => useRunStore.getState().setCurrentInstance(slug, i)}
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
      </div>
    </div>
  )
}
