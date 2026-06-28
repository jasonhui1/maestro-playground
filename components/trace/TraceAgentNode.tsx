'use client'
import React, { memo } from 'react'
import { Handle, Position, type NodeProps, type Node } from '@xyflow/react'
import type { InputSocket, OutputSocket } from '@/lib/graph'

export type TraceAgentNodeData = {
  label: string
  status?: 'success' | 'error'
  stale?: boolean
  defMissing?: boolean
  inputs: InputSocket[]
  outputs: OutputSocket[]
}
export type TraceAgentNodeType = Node<TraceAgentNodeData, 'agent'>

// evenly distribute N handles down the side of the node
const topFor = (i: number, n: number) => `${((i + 1) / (n + 1)) * 100}%`

function TraceAgentNode({ data, selected }: NodeProps<TraceAgentNodeType>) {
  const { inputs, outputs } = data
  const statusColor = data.stale ? 'bg-zinc-300' : data.status === 'error' ? 'bg-red-500' : 'bg-green-500'
  return (
    <div className={`relative px-4 py-3 rounded-lg shadow-md border-2 min-w-[200px] ${data.stale ? 'bg-zinc-50 opacity-70' : 'bg-white'} ${selected ? 'border-zinc-900 ring-4 ring-zinc-900/5' : 'border-zinc-200'}`}>
      {/* input handles (left) */}
      {inputs.map((s, i) => (
        <React.Fragment key={s.id}>
          <Handle
            type="target"
            id={s.id}
            position={Position.Left}
            style={{ top: topFor(i, inputs.length) }}
            className={`w-2.5 h-2.5 border-2 border-white ${s.unresolvedField ? '!bg-amber-400' : '!bg-zinc-400'}`}
          />
          <span className="absolute left-3 text-[9px] text-zinc-400 font-mono -translate-y-1/2" style={{ top: topFor(i, inputs.length) }}>{s.label}</span>
        </React.Fragment>
      ))}

      <div className="flex flex-col">
        <div className="flex items-center gap-2 mb-1">
          <div className={`w-2 h-2 rounded-full ${statusColor}`} />
          <span className="text-[10px] font-bold text-zinc-400 uppercase tracking-widest">
            {data.stale ? 'Not run' : data.defMissing ? 'Def missing' : 'Agent'}
          </span>
        </div>
        <div className="text-sm font-bold text-zinc-900">{data.label}</div>
      </div>

      {/* output handles (right) */}
      {outputs.map((s, i) => (
        <React.Fragment key={s.id}>
          <Handle
            type="source"
            id={s.id}
            position={Position.Right}
            style={{ top: topFor(i, outputs.length) }}
            className={`w-2.5 h-2.5 border-2 border-white ${s.undeclared ? '!bg-amber-400' : !s.present ? '!bg-red-400' : '!bg-zinc-900'}`}
          />
          <span className="absolute right-3 text-[9px] text-zinc-400 font-mono -translate-y-1/2 text-right" style={{ top: topFor(i, outputs.length) }}>.{s.name}</span>
        </React.Fragment>
      ))}
    </div>
  )
}
export default memo(TraceAgentNode)
