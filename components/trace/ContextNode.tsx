'use client'
import React, { memo } from 'react'
import { Handle, Position, type NodeProps, type Node } from '@xyflow/react'
import { FileText } from 'lucide-react'

export type ContextNodeType = Node<{ label: string }, 'context'>

function ContextNode({ data, selected }: NodeProps<ContextNodeType>) {
  return (
    <div className={`px-4 py-3 rounded-lg bg-amber-50 border-2 shadow-md min-w-[140px] ${selected ? 'border-zinc-900 ring-4 ring-zinc-900/5' : 'border-amber-200'}`}>
      <div className="flex items-center gap-2">
        <FileText size={14} className="text-amber-600" />
        <span className="text-sm font-bold text-zinc-900 font-mono">{data.label}</span>
      </div>
      <Handle type="source" id="file" position={Position.Right} className="w-3 h-3 !bg-amber-500 border-2 border-white" />
    </div>
  )
}
export default memo(ContextNode)
