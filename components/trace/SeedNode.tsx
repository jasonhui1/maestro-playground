'use client'
import React, { memo } from 'react'
import { Handle, Position, type NodeProps, type Node } from '@xyflow/react'
import { Sparkles } from 'lucide-react'

export type SeedNodeType = Node<{ label: string }, 'seed'>

function SeedNode({ data, selected }: NodeProps<SeedNodeType>) {
  return (
    <div className={`px-4 py-3 rounded-lg bg-white border-2 shadow-md min-w-[140px] ${selected ? 'border-zinc-900 ring-4 ring-zinc-900/5' : 'border-zinc-200'}`}>
      <div className="flex items-center gap-2">
        <Sparkles size={14} className="text-zinc-500" />
        <span className="text-sm font-bold text-zinc-900">{data.label}</span>
      </div>
      <Handle type="source" id="output" position={Position.Right} className="w-3 h-3 !bg-zinc-900 border-2 border-white" />
    </div>
  )
}
export default memo(SeedNode)
