'use client'
import React, { useCallback, useEffect, useMemo, useState } from 'react'
import dagre from 'dagre'
import { useAutoSave } from '@/hooks/useAutoSave'
import { serializeChain } from '@/lib/serializeChain'
import { validateChain } from '@/lib/chainGraph'
import { inputSocketsOf, outputSocketsOf } from '@/lib/nodeSockets'
import { connectEdge, deleteNode as opDeleteNode, deleteEdge as opDeleteEdge, uniqueNodeId, makeLoopZone, copySubgraph, pasteSubgraph, type Subgraph } from '@/lib/editorOps'
import type { ChainDef, ChainNode, ChainEdge, AgentDef, ChainNodeKind } from '@/lib/types'
import type { EditorNodeData } from './nodeData'
import ChainCanvas from './ChainCanvas'
import NodePalette from './NodePalette'
import ValidationPanel from './ValidationPanel'
import AgentDrawer from './AgentDrawer'
import { streamRun } from '@/lib/runStream'
import { applyRunEvent, type RunStateMap } from '@/lib/runState'
import NodePreview from './NodePreview'
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

export default function ChainEditor({ slug, initialChain, agents, contextFiles, refetchAgents }: {
  slug: string
  initialChain: ChainDef
  agents: AgentDef[]
  contextFiles: { slug: string; name: string }[]
  refetchAgents?: () => void
}) {
  const [nodes, setNodes] = useState<ChainNode[]>(() => seedPositions(initialChain.nodes, initialChain.edges))
  const [edges, setEdges] = useState<ChainEdge[]>(initialChain.edges)
  const [selectedIds, setSelectedIds] = useState<string[]>([])
  const primaryId = selectedIds[0] ?? null
  const [drawerSlug, setDrawerSlug] = useState<string | null>(null)
  const meta = useMemo(() => ({ name: initialChain.name, description: initialChain.description }), [initialChain])

  const initialMarkdown = useMemo(() => serializeChain(meta, seedPositions(initialChain.nodes, initialChain.edges), initialChain.edges), [meta, initialChain])
  const { setContent, status, flush } = useAutoSave('chain', slug, initialMarkdown)

  const [runState, setRunState] = useState<RunStateMap>({})
  const [seedPrompt, setSeedPrompt] = useState('')
  const [running, setRunning] = useState(false)
  const [runError, setRunError] = useState<string | null>(null)

  // Push every graph change into the autosave pipeline as serialized markdown.
  useEffect(() => {
    setContent(serializeChain(meta, nodes, edges))
  }, [meta, nodes, edges, setContent])

  const chain: ChainDef = useMemo(() => ({ ...initialChain, nodes, edges }), [initialChain, nodes, edges])
  const validation = useMemo(() => validateChain(chain, agents), [chain, agents])

  const issuesByNode = useMemo(() => {
    const m = new Map<string, string[]>()
    for (const i of validation.issues) {
      const id = i.nodeId ?? i.edge?.toNode
      if (!id) continue
      m.set(id, [...(m.get(id) ?? []), i.message])
    }
    return m
  }, [validation])

  const run = useCallback(async () => {
    setRunError(null)
    setRunState({})
    setRunning(true)
    try {
      await flush(serializeChain(meta, nodes, edges)) // save-then-run: disk = canvas
      const res = await fetch('/api/run', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chainName: slug, seedPrompt, type: 'chain', slug }),
      })
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        setRunError((body.errors as string[] | undefined)?.join('; ') ?? body.error ?? `Run failed (${res.status})`)
        return
      }
      const reader = res.body?.getReader()
      if (!reader) return
      await streamRun(reader, e => {
        if (e.type === 'error') { setRunError(e.error); return }
        setRunState(prev => applyRunEvent(prev, e))
      })
    } catch (err) {
      setRunError(err instanceof Error ? err.message : String(err))
    } finally {
      setRunning(false)
    }
  }, [flush, meta, nodes, edges, slug, seedPrompt])

  const updateNode = useCallback((id: string, patch: Partial<ChainNode>) => {
    setNodes(prev => prev.map(n => n.id === id ? { ...n, ...patch } : n))
  }, [])

  const moveNode = useCallback((id: string, pos: [number, number]) => {
    setNodes(prev => prev.map(n => n.id === id ? { ...n, pos } : n))
  }, [])

  const addNodeOfKind = useCallback((kind: ChainNodeKind) => {
    setNodes(prev => {
      const id = uniqueNodeId(kind, prev.map(n => n.id))
      const node: ChainNode = { id, kind, pos: [80, 80] }
      return [...prev, node]
    })
  }, [])

  const addLoopZone = useCallback(() => {
    setNodes(prev => {
      const pair = makeLoopZone(prev.map(n => n.id), [120, 120])
      return [...prev, ...pair]
    })
  }, [])

  const connect = useCallback((edge: ChainEdge) => {
    setEdges(prev => connectEdge(prev, edge))
  }, [])

  const deleteNode = useCallback((id: string) => {
    setNodes(prev => prev.filter(n => n.id !== id))
    setEdges(prev => prev.filter(e => e.fromNode !== id && e.toNode !== id))
    if (selectedIds.includes(id)) setSelectedIds(prev => prev.filter(x => x !== id))
  }, [selectedIds])

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

  const deleteEdge = useCallback((edge: ChainEdge) => {
    setEdges(prev => opDeleteEdge(prev, edge))
  }, [])

  const buildData = useCallback((node: ChainNode): EditorNodeData => ({
    node,
    inputs: inputSocketsOf(node, chain, agents),
    outputs: outputSocketsOf(node, chain, agents),
    agents: agents.map(a => ({ slug: a.slug, name: a.name })),
    contextFiles,
    run: runState[node.id],
    issues: issuesByNode.get(node.id) ?? [],
    onChange: patch => updateNode(node.id, patch),
    onEditAgent: (s: string) => setDrawerSlug(s),
  }), [chain, agents, contextFiles, runState, issuesByNode, updateNode])

  return (
    <div className="h-full flex flex-col">
      <div className="px-4 py-2 border-b border-zinc-100 flex items-center gap-3">
        <input
          value={seedPrompt}
          onChange={e => setSeedPrompt(e.target.value)}
          placeholder="Seed prompt ({input})…"
          className="flex-1 text-xs border border-zinc-200 rounded px-2 py-1"
        />
        <button
          onClick={run}
          disabled={running}
          className="flex items-center gap-1.5 px-3 py-1.5 bg-zinc-900 text-white text-xs font-medium rounded-md hover:bg-zinc-800 disabled:opacity-50"
        >
          <Play size={12} className="fill-current" />
          {running ? 'Running…' : 'Run'}
        </button>
        <span className="text-[10px] font-bold text-zinc-400 uppercase tracking-widest">{status}</span>
      </div>

      {runError && <div className="px-4 py-1.5 text-[11px] text-red-600 bg-red-50 border-b border-red-100">{runError}</div>}

      <div className="flex-1 min-h-0 flex">
        <NodePalette onAdd={addNodeOfKind} onAddLoopZone={addLoopZone} />
        <div className="flex-1 min-w-0 relative">
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

      <ValidationPanel issues={validation.issues} onSelect={(id) => setSelectedIds(id ? [id] : [])} />
      <div className="h-40 border-t border-zinc-200 bg-white overflow-hidden">
        <NodePreview run={primaryId ? runState[primaryId] : undefined} nodeId={primaryId} />
      </div>
    </div>
  )
}
