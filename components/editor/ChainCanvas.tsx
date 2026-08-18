'use client'
import React, { useCallback, useMemo, useState } from 'react'
import {
  ReactFlow, Background, Controls, ReactFlowProvider,
  type Node, type Edge, type NodeProps, type NodeChange,
} from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import type { ChainNode, ChainEdge, ChainNodeKind } from '@/lib/types'
import type { EditorNodeData, EditorNodeDataOf } from './nodeData'
import { computeZoneFrames } from '@/lib/zoneFrames'
import { applyViewChanges, emptyCanvasView, overlay, type CanvasView } from '@/lib/canvasView'
import InstanceSwitcher from '@/components/workspace/InstanceSwitcher'
import SeedNode from './nodes/SeedNode'
import ContextNode from './nodes/ContextNode'
import AgentNode from './nodes/AgentNode'
import GateNode from './nodes/GateNode'
import BranchNode from './nodes/BranchNode'
import LoopStartNode from './nodes/LoopStartNode'
import LoopEndNode from './nodes/LoopEndNode'
import ZoneFrame from './nodes/ZoneFrame'
import SubchainNode from './nodes/SubchainNode'
import ReportNode from './nodes/ReportNode'
import JoinNode from './nodes/JoinNode'

// Each kind maps to the component that renders it. Keying by the mapped type gives
// two compile-time guarantees at once: every kind must have an entry (miss one and it
// won't compile), and each entry must be *that kind's* component — a mis-wire like
// `gate: ContextNode` is a type error, because each component declares its kind via
// EditorNodeDataOf<K> in its props. `zoneFrame` is the loop-zone bounding box, not a
// node kind, so it sits outside the mapped type.
type KindComponents = { [K in ChainNodeKind]: React.ComponentType<NodeProps<Node<EditorNodeDataOf<K>>>> }
const nodeTypes: KindComponents & { zoneFrame: React.ComponentType<any> } = {
  seed: SeedNode, context: ContextNode, agent: AgentNode, decider: AgentNode,
  gate: GateNode, branch: BranchNode, 'loop-start': LoopStartNode, 'loop-end': LoopEndNode,
  subchain: SubchainNode,
  report: ReportNode,
  join: JoinNode,
  zoneFrame: ZoneFrame,
}

interface ChainCanvasProps {
  nodes: ChainNode[]
  edges: ChainEdge[]
  buildData: (node: ChainNode) => EditorNodeData
  selectedIds: string[]
  onSelectionChange: (ids: string[]) => void
  onMove: (id: string, pos: [number, number]) => void
  onMoveMany: (updates: { id: string; pos: [number, number] }[]) => void
  onConnect: (edge: ChainEdge) => void
  onDeleteNode: (id: string) => void
  onDeleteEdge: (edge: ChainEdge) => void
  instanceCount: number
  currentInstance: number
  onInstance: (i: number) => void
  readOnly?: boolean
}

function edgeId(e: ChainEdge): string {
  return `${e.fromNode}.${e.fromSocket}->${e.toNode}.${e.toSocket}`
}

export default function ChainCanvas(props: ChainCanvasProps) {
  const { nodes: chainNodes, selectedIds, buildData, onSelectionChange, onMoveMany } = props

  // The nodes are projected from the chain on every render rather than mirrored into
  // state, so a caller handing us a fresh `selectedIds` array costs one recompute
  // instead of an effect that re-fires into "Maximum update depth exceeded" (#64).
  const base = useMemo<Node[]>(() => {
    const frames: Node[] = computeZoneFrames(chainNodes).map(f => ({
      id: `zone-frame-${f.zone}`,
      type: 'zoneFrame',
      position: { x: f.x, y: f.y },
      data: { zone: f.zone, width: f.width, height: f.height },
      selectable: false,
      draggable: false,
      zIndex: -1,
    }))
    const nodes: Node[] = chainNodes.map(n => ({
      id: n.id,
      type: n.kind,
      position: { x: n.pos?.[0] ?? 0, y: n.pos?.[1] ?? 0 },
      data: buildData(n),
      selected: selectedIds.includes(n.id),
    }))
    return [...frames, ...nodes]
  }, [chainNodes, selectedIds, buildData])

  // What React Flow owns on top of that: measured sizes, then the live drag position.
  // Layered in that order so a gesture rebuilds only the node under the cursor.
  const [view, setView] = useState<CanvasView>(emptyCanvasView)
  const measured = useMemo(() => overlay(base, view.measured), [base, view.measured])
  const rfNodes = useMemo(() => overlay(measured, view.drag), [measured, view.drag])

  const onNodesChange = useCallback((changes: NodeChange[]) => {
    setView(v => applyViewChanges(v, changes))
  }, [])

  const handleSelectionChange = useCallback(
    ({ nodes }: { nodes: Node[] }) => onSelectionChange(nodes.map(n => n.id)),
    [onSelectionChange],
  )
  const handleSelectionDragStop = useCallback(
    (_: React.MouseEvent, nodes: Node[]) =>
      onMoveMany(nodes.map(n => ({ id: n.id, pos: [n.position.x, n.position.y] as [number, number] }))),
    [onMoveMany],
  )

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
    <div className="w-full h-full bg-zinc-50 relative">
      {props.instanceCount > 1 && (
        <div className="absolute top-2 right-2 z-10 bg-white/90 border border-zinc-200 rounded-md px-2 py-1 shadow-sm">
          <InstanceSwitcher count={props.instanceCount} index={props.currentInstance} onChange={props.onInstance} />
        </div>
      )}
      <ReactFlowProvider>
        <ReactFlow
          nodes={rfNodes}
          edges={rfEdges}
          nodeTypes={nodeTypes}
          onNodesChange={onNodesChange}
          nodesDraggable={!props.readOnly}
          nodesConnectable={!props.readOnly}
          edgesReconnectable={!props.readOnly}
          onNodeDragStop={props.readOnly ? undefined : (_, node) => props.onMove(node.id, [node.position.x, node.position.y])}
          onSelectionChange={handleSelectionChange}
          onSelectionDragStop={props.readOnly ? undefined : handleSelectionDragStop}
          selectionKeyCode="Shift"
          multiSelectionKeyCode={['Meta', 'Control']}
          onConnect={props.readOnly ? undefined : (c) => {
            if (!c.source || !c.target || !c.sourceHandle || !c.targetHandle) return
            if (c.source === c.target) return
            props.onConnect({ fromNode: c.source, fromSocket: c.sourceHandle, toNode: c.target, toSocket: c.targetHandle })
          }}
          onDelete={props.readOnly ? undefined : ({ nodes, edges }) => {
            nodes.forEach(n => props.onDeleteNode(n.id))
            edges.forEach(e => {
              const edge = props.edges.find(x => edgeId(x) === e.id)
              if (edge) props.onDeleteEdge(edge)
            })
          }}
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
