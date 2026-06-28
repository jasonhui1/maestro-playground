'use client'
import React, { useMemo } from 'react'
import {
  ReactFlow, Background, Controls, ReactFlowProvider,
  Position, type Node, type Edge, type NodeTypes,
} from '@xyflow/react'
import dagre from 'dagre'
import '@xyflow/react/dist/style.css'
import type { TraceGraph } from '@/lib/graph'
import TraceAgentNode from './TraceAgentNode'
import SeedNode from './SeedNode'
import ContextNode from './ContextNode'

const nodeTypes: NodeTypes = { agent: TraceAgentNode, seed: SeedNode, context: ContextNode }
const NODE_W = 220
const NODE_H = 90

function layout(graph: TraceGraph): { nodes: Node[]; edges: Edge[] } {
  const g = new dagre.graphlib.Graph()
  g.setDefaultEdgeLabel(() => ({}))
  g.setGraph({ rankdir: 'LR', nodesep: 40, ranksep: 90 })

  graph.nodes.forEach(n => g.setNode(n.id, { width: NODE_W, height: NODE_H }))
  graph.edges.forEach(e => g.setEdge(e.source, e.target))
  dagre.layout(g)

  const nodes: Node[] = graph.nodes.map(n => {
    const p = g.node(n.id)
    return {
      id: n.id,
      type: n.kind,
      position: { x: p.x - NODE_W / 2, y: p.y - NODE_H / 2 },
      sourcePosition: Position.Right,
      targetPosition: Position.Left,
      data: n.kind === 'agent'
        ? { label: n.label, status: n.status, stale: n.stale, defMissing: n.defMissing, inputs: n.inputs || [], outputs: n.outputs || [] }
        : { label: n.label },
    }
  })

  const edges: Edge[] = graph.edges.map(e => ({
    id: e.id,
    source: e.source,
    sourceHandle: e.sourceHandle,
    target: e.target,
    targetHandle: e.targetHandle,
    animated: !e.flagged,
    style: { stroke: e.flagged ? '#f59e0b' : '#a1a1aa', strokeWidth: 2, strokeDasharray: e.flagged ? '5 5' : undefined },
  }))

  return { nodes, edges }
}

export default function RunGraph({ graph, selectedNodeId, onSelectNode }: {
  graph: TraceGraph
  selectedNodeId: string | null
  onSelectNode: (id: string | null) => void
}) {
  const { nodes, edges } = useMemo(() => layout(graph), [graph])
  const withSelection = nodes.map(n => ({ ...n, selected: n.id === selectedNodeId }))

  return (
    <div className="w-full h-[520px] bg-zinc-50 border border-zinc-200 rounded-2xl overflow-hidden">
      <ReactFlowProvider>
        <ReactFlow
          nodes={withSelection}
          edges={edges}
          nodeTypes={nodeTypes}
          onNodeClick={(_, node) => onSelectNode(node.id)}
          onPaneClick={() => onSelectNode(null)}
          fitView
          fitViewOptions={{ padding: 0.2 }}
          proOptions={{ hideAttribution: true }}
        >
          <Background color="#e5e7eb" gap={20} />
          <Controls showInteractive={false} />
        </ReactFlow>
      </ReactFlowProvider>
    </div>
  )
}
