'use client'
import React, { useMemo } from 'react'
import {
  ReactFlow, Background, Controls, ReactFlowProvider,
  type Node, type Edge, type NodeTypes, type Connection,
} from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import type { ChainNode, ChainEdge } from '@/lib/types'
import type { EditorNodeData } from './nodeData'
import { computeZoneFrames } from '@/lib/zoneFrames'
import SeedNode from './nodes/SeedNode'
import ContextNode from './nodes/ContextNode'
import AgentNode from './nodes/AgentNode'
import GateNode from './nodes/GateNode'
import BranchNode from './nodes/BranchNode'
import LoopStartNode from './nodes/LoopStartNode'
import LoopEndNode from './nodes/LoopEndNode'
import ZoneFrame from './nodes/ZoneFrame'

const nodeTypes: NodeTypes = {
  seed: SeedNode, context: ContextNode, agent: AgentNode, decider: AgentNode,
  gate: GateNode, branch: BranchNode, 'loop-start': LoopStartNode, 'loop-end': LoopEndNode,
  zoneFrame: ZoneFrame,
}

interface ChainCanvasProps {
  nodes: ChainNode[]
  edges: ChainEdge[]
  buildData: (node: ChainNode) => EditorNodeData
  selectedId: string | null
  onSelect: (id: string | null) => void
  onMove: (id: string, pos: [number, number]) => void
  onConnect: (edge: ChainEdge) => void
  onDeleteNode: (id: string) => void
  onDeleteEdge: (edge: ChainEdge) => void
}

function edgeId(e: ChainEdge): string {
  return `${e.fromNode}.${e.fromSocket}->${e.toNode}.${e.toSocket}`
}

export default function ChainCanvas(props: ChainCanvasProps) {
  const rfNodes = useMemo<Node[]>(() => {
    const frames: Node[] = computeZoneFrames(props.nodes).map(f => ({
      id: `zone-frame-${f.zone}`,
      type: 'zoneFrame',
      position: { x: f.x, y: f.y },
      data: { zone: f.zone, width: f.width, height: f.height },
      selectable: false,
      draggable: false,
      zIndex: -1,
    }))
    const nodes: Node[] = props.nodes.map(n => ({
      id: n.id,
      type: n.kind,
      position: { x: n.pos?.[0] ?? 0, y: n.pos?.[1] ?? 0 },
      data: props.buildData(n),
      selected: n.id === props.selectedId,
    }))
    return [...frames, ...nodes]
  }, [props.nodes, props.selectedId, props.buildData])

  const rfEdges = useMemo<Edge[]>(() => props.edges.map(e => ({
    id: edgeId(e),
    source: e.fromNode,
    sourceHandle: e.fromSocket,
    target: e.toNode,
    targetHandle: e.toSocket,
    animated: true,
    style: { stroke: '#a1a1aa', strokeWidth: 2 },
  })), [props.edges])

  return (
    <div className="w-full h-full bg-zinc-50">
      <ReactFlowProvider>
        <ReactFlow
          nodes={rfNodes}
          edges={rfEdges}
          nodeTypes={nodeTypes}
          onNodeClick={(_, node) => props.onSelect(node.id)}
          onPaneClick={() => props.onSelect(null)}
          onNodeDragStop={(_, node) => props.onMove(node.id, [node.position.x, node.position.y])}
          onConnect={(c: Connection) => {
            if (!c.source || !c.target || !c.sourceHandle || !c.targetHandle) return
            if (c.source === c.target) return
            props.onConnect({ fromNode: c.source, fromSocket: c.sourceHandle, toNode: c.target, toSocket: c.targetHandle })
          }}
          onNodesDelete={(deleted) => deleted.forEach(d => props.onDeleteNode(d.id))}
          onEdgesDelete={(deleted) => deleted.forEach(d => {
            const e = props.edges.find(x => edgeId(x) === d.id)
            if (e) props.onDeleteEdge(e)
          })}
          fitView
          proOptions={{ hideAttribution: true }}
        >
          <Background color="#e5e7eb" gap={20} />
          <Controls showInteractive={false} />
        </ReactFlow>
      </ReactFlowProvider>
    </div>
  )
}
