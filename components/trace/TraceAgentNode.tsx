'use client'
import React, { memo } from 'react'
import { Handle, Position, type NodeProps, type Node } from '@xyflow/react'
import type { InputSocket, OutputSocket } from '@/lib/graph'

export type TraceAgentNodeData = {
  label: string
  status?: 'success' | 'error' | 'skipped'
  stale?: boolean
  defMissing?: boolean
  inputs: InputSocket[]
  outputs: OutputSocket[]
}
export type TraceAgentNodeType = Node<TraceAgentNodeData, 'agent'>

function TraceAgentNode({ data, selected }: NodeProps<TraceAgentNodeType>) {
  const { inputs, outputs } = data
  const statusColor = data.stale || data.status === 'skipped' ? 'bg-zinc-300' : data.status === 'error' ? 'bg-red-500' : 'bg-green-500'
  return (
    <div className={`relative rounded-lg shadow-md border-2 min-w-[240px] bg-white ${data.status === 'skipped' ? 'opacity-60' : ''} ${selected ? 'border-zinc-900 ring-4 ring-zinc-900/5' : 'border-zinc-200'}`}>
      {/* Header */}
      <div className="px-4 py-2 border-b border-zinc-100 bg-zinc-50/50 rounded-t-lg">
        <div className="flex items-center gap-2 mb-0.5">
          <div className={`w-2 h-2 rounded-full ${statusColor}`} />
          <span className="text-[9px] font-bold text-zinc-400 uppercase tracking-widest">
            {data.status === 'skipped' ? 'Skipped' : data.stale ? 'Not run' : data.defMissing ? 'Def missing' : 'Agent'}
          </span>
        </div>
        <div className="text-xs font-bold text-zinc-900">{data.label}</div>
      </div>

      {/* Sockets area */}
      {(inputs.length > 0 || outputs.length > 0) && (
        <div className="px-4 py-2 flex justify-between gap-4 text-[9px] font-mono text-zinc-400">
          <div className="flex flex-col gap-1.5 align-left">
            {inputs.map((s) => (
              <div key={s.id} className="relative pl-3 flex items-center h-5">
                <Handle
                  type="target"
                  id={s.id}
                  position={Position.Left}
                  style={{ left: -16, top: '50%', transform: 'translateY(-50%)' }}
                  className={`w-2.5 h-2.5 border-2 border-white ${s.unresolvedField ? '!bg-amber-400' : '!bg-zinc-400'}`}
                />
                <span className="truncate max-w-[100px]" title={s.label}>{s.label}</span>
              </div>
            ))}
          </div>
          <div className="flex flex-col gap-1.5 align-right text-right">
            {outputs.map((s) => (
              <div key={s.id} className="relative pr-3 flex items-center justify-end h-5">
                <span className="truncate max-w-[100px]" title={`.${s.name}`}>.{s.name}</span>
                <Handle
                  type="source"
                  id={s.id}
                  position={Position.Right}
                  style={{ right: -16, top: '50%', transform: 'translateY(-50%)' }}
                  className={`w-2.5 h-2.5 border-2 border-white ${s.undeclared ? '!bg-amber-400' : !s.present ? '!bg-red-400' : '!bg-zinc-900'}`}
                />
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
export default memo(TraceAgentNode)
