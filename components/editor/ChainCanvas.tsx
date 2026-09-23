'use client'
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  ReactFlow, Background, Controls, ReactFlowProvider, useReactFlow,
  BaseEdge, EdgeLabelRenderer, getBezierPath,
  type Node, type Edge, type NodeProps, type NodeChange, type EdgeProps,
} from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import type { ChainNode, ChainEdge, ChainNodeKind } from '@/lib/types'
import type { EditorNodeData, EditorNodeDataOf } from './nodeData'
import { computeZoneFrames } from '@/lib/zoneFrames'
import { edgeFromConnection } from '@/lib/editorOps'
import { applySelectChanges, applyViewChanges, emptyCanvasView, overlay, type CanvasView } from '@/lib/canvasView'
import InstanceSwitcher from '@/components/workspace/InstanceSwitcher'
import SeedNode from './nodes/SeedNode'
import ContextNode from './nodes/ContextNode'
import ParamNode from './nodes/ParamNode'
import AgentNode from './nodes/AgentNode'
import GateNode from './nodes/GateNode'
import BranchNode from './nodes/BranchNode'
import LoopStartNode from './nodes/LoopStartNode'
import LoopEndNode from './nodes/LoopEndNode'
import ZoneFrame from './nodes/ZoneFrame'
import SubchainNode from './nodes/SubchainNode'
import ReportNode from './nodes/ReportNode'
import JoinNode from './nodes/JoinNode'
import HoldNode from './nodes/HoldNode'

// Custom edge with hover highlight and quick-disconnect badge (#146).
interface DeletableEdgeData extends Record<string, unknown> {
  edge: ChainEdge
  onDelete?: () => void
  readOnly?: boolean
}

export function DeletableEdge({
  sourceX,
  sourceY,
  targetX,
  targetY,
  sourcePosition,
  targetPosition,
  style,
  markerEnd,
  data,
}: EdgeProps<Edge<DeletableEdgeData>>) {
  const [hovered, setHovered] = useState(false)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const handleMouseEnter = useCallback(() => {
    if (timerRef.current) {
      clearTimeout(timerRef.current)
      timerRef.current = null
    }
    setHovered(true)
  }, [])

  const handleMouseLeave = useCallback(() => {
    if (timerRef.current) clearTimeout(timerRef.current)
    timerRef.current = setTimeout(() => {
      setHovered(false)
    }, 80)
  }, [])

  useEffect(() => () => {
    if (timerRef.current) clearTimeout(timerRef.current)
  }, [])

  const [edgePath, labelX, labelY] = getBezierPath({
    sourceX,
    sourceY,
    sourcePosition,
    targetPosition,
    targetX,
    targetY,
  })

  return (
    <>
      <g onMouseEnter={handleMouseEnter} onMouseLeave={handleMouseLeave}>
        <path
          d={edgePath}
          fill="none"
          stroke="transparent"
          strokeWidth={20}
          className="cursor-pointer"
        />
        <BaseEdge
          path={edgePath}
          markerEnd={markerEnd}
          style={{
            ...style,
            stroke: hovered ? '#18181b' : (style?.stroke ?? '#a1a1aa'),
            strokeWidth: hovered ? 2.5 : (style?.strokeWidth ?? 2),
            transition: 'stroke 0.15s, stroke-width 0.15s',
          }}
        />
      </g>
      {!data?.readOnly && hovered && (
        <EdgeLabelRenderer>
          <div
            style={{
              position: 'absolute',
              transform: `translate(-50%, -50%) translate(${labelX}px,${labelY}px)`,
              pointerEvents: 'all',
            }}
            className="nodrag nopan"
            onMouseEnter={handleMouseEnter}
            onMouseLeave={handleMouseLeave}
          >
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation()
                data?.onDelete?.()
              }}
              title="Disconnect edge"
              aria-label="Disconnect edge"
              className="w-4 h-4 bg-white border border-zinc-300 hover:border-red-500 rounded-full flex items-center justify-center text-[10px] text-zinc-500 hover:text-red-600 hover:bg-red-50 shadow-sm transition-colors cursor-pointer"
            >
              ✕
            </button>
          </div>
        </EdgeLabelRenderer>
      )}
    </>
  )
}

const edgeTypes = {
  deletable: DeletableEdge,
  default: DeletableEdge,
}

// Each kind maps to the component that renders it. Keying by the mapped type gives
// two compile-time guarantees at once: every kind must have an entry (miss one and it
// won't compile), and each entry must be *that kind's* component — a mis-wire like
// `gate: ContextNode` is a type error, because each component declares its kind via
// EditorNodeDataOf<K> in its props. `zoneFrame` is the loop-zone bounding box, not a
// node kind, so it sits outside the mapped type.
type KindComponents = { [K in ChainNodeKind]: React.ComponentType<NodeProps<Node<EditorNodeDataOf<K>>>> }
const nodeTypes: KindComponents & { zoneFrame: React.ComponentType<any> } = {
  seed: SeedNode, context: ContextNode, param: ParamNode, agent: AgentNode, decider: AgentNode,
  gate: GateNode, branch: BranchNode, 'loop-start': LoopStartNode, 'loop-end': LoopEndNode,
  subchain: SubchainNode,
  report: ReportNode,
  join: JoinNode,
  hold: HoldNode,
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
  onAddNode?: (kind: ChainNodeKind, pos: [number, number], extra?: Partial<ChainNode>) => void
  onAddLoopZone?: (pos: [number, number]) => void
  agents?: { slug: string; name: string }[]
  contextFiles?: { slug: string; name: string }[]
  onRun?: () => void
}

import QuickAddMenu, { type QuickAddItem } from './QuickAddMenu'

function edgeId(e: ChainEdge): string {
  return `${e.fromNode}.${e.fromSocket}->${e.toNode}.${e.toSocket}`
}

function CanvasContent(props: ChainCanvasProps) {
  const { nodes: chainNodes, selectedIds, buildData, onSelectionChange, onMoveMany } = props
  const { screenToFlowPosition } = useReactFlow()
  const [menuPos, setMenuPos] = useState<{ clientX: number; clientY: number } | null>(null)
  const mousePosRef = useRef<{ clientX: number; clientY: number }>({ clientX: 0, clientY: 0 })
  const isOverCanvasRef = useRef(false)

  useEffect(() => {
    if (props.readOnly) return
    const onKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && (e.key === 'Enter' || e.key === 'enter')) {
        if (props.onRun) {
          e.preventDefault()
          props.onRun()
          return
        }
      }
      if (!isOverCanvasRef.current) return
      const t = e.target as HTMLElement | null
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable)) return
      if (e.shiftKey && (e.key === 'A' || e.key === 'a')) {
        e.preventDefault()
        const clientX = mousePosRef.current.clientX || window.innerWidth / 2
        const clientY = mousePosRef.current.clientY || window.innerHeight / 2
        setMenuPos({ clientX, clientY })
      } else if (e.key === 'Escape') {
        setMenuPos(null)
      }
    }
    const onMouseMove = (e: MouseEvent) => {
      mousePosRef.current = { clientX: e.clientX, clientY: e.clientY }
    }
    window.addEventListener('keydown', onKeyDown)
    window.addEventListener('mousemove', onMouseMove)
    return () => {
      window.removeEventListener('keydown', onKeyDown)
      window.removeEventListener('mousemove', onMouseMove)
    }
  }, [props.readOnly, props.onRun])

  const handleSelectMenuItem = useCallback((item: QuickAddItem) => {
    if (!menuPos) return
    const flowPos = screenToFlowPosition({ x: menuPos.clientX, y: menuPos.clientY })
    const pos: [number, number] = [Math.round(flowPos.x), Math.round(flowPos.y)]
    if (item.type === 'agent') {
      props.onAddNode?.('agent', pos, { agent: item.slug })
    } else if (item.type === 'source-seed') {
      props.onAddNode?.('seed', pos)
    } else if (item.type === 'source-context') {
      props.onAddNode?.('context', pos, item.file ? { file: item.file } : undefined)
    } else if (item.type === 'control-loop') {
      props.onAddLoopZone?.(pos)
    } else if (item.type === 'control-gate') {
      props.onAddNode?.('gate', pos)
    }
    setMenuPos(null)
  }, [menuPos, screenToFlowPosition, props.onAddNode, props.onAddLoopZone])

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
    const next = applySelectChanges(selectedIds, changes)
    if (next) onSelectionChange(next)
  }, [selectedIds, onSelectionChange])

  const handleSelectionDragStop = useCallback(
    (_: React.MouseEvent, nodes: Node[]) =>
      onMoveMany(nodes.map(n => ({ id: n.id, pos: [n.position.x, n.position.y] as [number, number] }))),
    [onMoveMany],
  )

  const rfEdges = useMemo<Edge<DeletableEdgeData>[]>(() => props.edges.map(e => ({
    id: edgeId(e),
    type: 'deletable',
    source: e.fromNode,
    sourceHandle: e.fromSocket,
    target: e.toNode,
    targetHandle: e.toSocket,
    animated: true,
    style: { stroke: '#a1a1aa', strokeWidth: 2 },
    data: {
      edge: e,
      onDelete: () => props.onDeleteEdge(e),
      readOnly: props.readOnly,
    },
  })), [props.edges, props.onDeleteEdge, props.readOnly])

  return (
    <div
      onMouseEnter={() => { isOverCanvasRef.current = true }}
      onMouseLeave={() => { isOverCanvasRef.current = false }}
      className="w-full h-full bg-zinc-50 relative"
    >
      {props.instanceCount > 1 && (
        <div className="absolute top-2 right-2 z-10 bg-white/90 border border-zinc-200 rounded-lg px-2 py-1 shadow-sm">
          <InstanceSwitcher count={props.instanceCount} index={props.currentInstance} onChange={props.onInstance} />
        </div>
      )}
      {menuPos && (
        <QuickAddMenu
          pos={menuPos}
          agents={props.agents ?? []}
          contextFiles={props.contextFiles ?? []}
          onClose={() => setMenuPos(null)}
          onSelect={handleSelectMenuItem}
        />
      )}
      <ReactFlow
        nodes={rfNodes}
        edges={rfEdges}
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        onNodesChange={onNodesChange}
        nodesDraggable={!props.readOnly}
        nodesConnectable={!props.readOnly}
        edgesReconnectable={!props.readOnly}
        onNodeDragStop={props.readOnly ? undefined : (_, node) => props.onMove(node.id, [node.position.x, node.position.y])}
        onSelectionDragStop={props.readOnly ? undefined : handleSelectionDragStop}
        selectionKeyCode="Shift"
        multiSelectionKeyCode={['Meta', 'Control']}
        onConnect={props.readOnly ? undefined : (c) => {
          const edge = edgeFromConnection(c)
          if (edge) props.onConnect(edge)
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
    </div>
  )
}

export default function ChainCanvas(props: ChainCanvasProps) {
  return (
    <ReactFlowProvider>
      <CanvasContent {...props} />
    </ReactFlowProvider>
  )
}
