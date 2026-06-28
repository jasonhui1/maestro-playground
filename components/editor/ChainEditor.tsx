'use client'
import React, { useCallback, useMemo, useState } from 'react'
import dagre from 'dagre'
import { useAutoSave } from '@/hooks/useAutoSave'
import { serializeChain } from '@/lib/serializeChain'
import { validateChain } from '@/lib/chainGraph'
import { inputSocketsOf, outputSocketsOf } from '@/lib/nodeSockets'
import { connectEdge, deleteNode as opDeleteNode, deleteEdge as opDeleteEdge, uniqueNodeId, makeLoopZone } from '@/lib/editorOps'
import type { ChainDef, ChainNode, ChainEdge, AgentDef, ChainNodeKind } from '@/lib/types'
import type { EditorNodeData } from './nodeData'
import ChainCanvas from './ChainCanvas'
import NodePalette from './NodePalette'
import ValidationPanel from './ValidationPanel'

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

export default function ChainEditor({ slug, initialChain, agents, contextFiles }: {
  slug: string
  initialChain: ChainDef
  agents: AgentDef[]
  contextFiles: { slug: string; name: string }[]
}) {
  const [nodes, setNodes] = useState<ChainNode[]>(() => seedPositions(initialChain.nodes, initialChain.edges))
  const [edges, setEdges] = useState<ChainEdge[]>(initialChain.edges)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const meta = useMemo(() => ({ name: initialChain.name, description: initialChain.description }), [initialChain])

  const initialMarkdown = useMemo(() => serializeChain(meta, seedPositions(initialChain.nodes, initialChain.edges), initialChain.edges), [meta, initialChain])
  const { setContent, status } = useAutoSave('chain', slug, initialMarkdown)

  // Push every graph change into the autosave pipeline as serialized markdown.
  const sync = useCallback((nextNodes: ChainNode[], nextEdges: ChainEdge[]) => {
    setContent(serializeChain(meta, nextNodes, nextEdges))
  }, [meta, setContent])

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

  const updateNode = useCallback((id: string, patch: Partial<ChainNode>) => {
    setNodes(prev => {
      const next = prev.map(n => n.id === id ? { ...n, ...patch } : n)
      sync(next, edges)
      return next
    })
  }, [edges, sync])

  const moveNode = useCallback((id: string, pos: [number, number]) => {
    setNodes(prev => {
      const next = prev.map(n => n.id === id ? { ...n, pos } : n)
      sync(next, edges)
      return next
    })
  }, [edges, sync])

  const addNodeOfKind = useCallback((kind: ChainNodeKind) => {
    setNodes(prev => {
      const id = uniqueNodeId(kind, prev.map(n => n.id))
      const node: ChainNode = { id, kind, pos: [80, 80] }
      const next = [...prev, node]
      sync(next, edges)
      return next
    })
  }, [edges, sync])

  const addLoopZone = useCallback(() => {
    setNodes(prev => {
      const pair = makeLoopZone(prev.map(n => n.id), [120, 120])
      const next = [...prev, ...pair]
      sync(next, edges)
      return next
    })
  }, [edges, sync])

  const connect = useCallback((edge: ChainEdge) => {
    setEdges(prev => {
      const next = connectEdge(prev, edge)
      sync(nodes, next)
      return next
    })
  }, [nodes, sync])

  const deleteNode = useCallback((id: string) => {
    const res = opDeleteNode(nodes, edges, id)
    setNodes(res.nodes); setEdges(res.edges); sync(res.nodes, res.edges)
    if (selectedId === id) setSelectedId(null)
  }, [nodes, edges, sync, selectedId])

  const deleteEdge = useCallback((edge: ChainEdge) => {
    setEdges(prev => {
      const next = opDeleteEdge(prev, edge)
      sync(nodes, next)
      return next
    })
  }, [nodes, sync])

  const buildData = useCallback((node: ChainNode): EditorNodeData => ({
    node,
    inputs: inputSocketsOf(node, chain, agents),
    outputs: outputSocketsOf(node, chain, agents),
    agents: agents.map(a => ({ slug: a.slug, name: a.name })),
    contextFiles,
    issues: issuesByNode.get(node.id) ?? [],
    onChange: patch => updateNode(node.id, patch),
  }), [chain, agents, contextFiles, issuesByNode, updateNode])

  return (
    <div className="h-full flex flex-col">
      <div className="flex-1 min-h-0 flex">
        <NodePalette onAdd={addNodeOfKind} onAddLoopZone={addLoopZone} />
        <div className="flex-1 min-w-0 relative">
          <div className="absolute top-2 right-2 z-10 text-[10px] font-bold text-zinc-400 uppercase tracking-widest">{status}</div>
          <ChainCanvas
            nodes={nodes}
            edges={edges}
            buildData={buildData}
            selectedId={selectedId}
            onSelect={setSelectedId}
            onMove={moveNode}
            onConnect={connect}
            onDeleteNode={deleteNode}
            onDeleteEdge={deleteEdge}
          />
        </div>
      </div>
      <ValidationPanel issues={validation.issues} onSelect={setSelectedId} />
    </div>
  )
}
