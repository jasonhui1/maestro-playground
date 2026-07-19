'use client'
import React, { memo } from 'react'
import { Handle, Position, type NodeProps, type Node } from '@xyflow/react'
import type { EditorNodeDataOf } from '../nodeData'

function SeedNode({ data }: NodeProps<Node<EditorNodeDataOf<'seed'>>>) {
  return (
    <div className="relative rounded-lg shadow-md border-2 border-zinc-200 bg-white min-w-[160px]">
      <div className="px-4 py-2 border-b border-zinc-100 bg-zinc-50/50 rounded-t-lg">
        <span className="text-[9px] font-bold text-zinc-400 uppercase tracking-widest">Seed</span>
        <div className="text-xs font-bold text-zinc-900">{data.node.id}</div>
      </div>
      <div className="px-4 py-2 flex justify-end text-[9px] font-mono text-zinc-400">
        <div className="relative pr-3 flex items-center justify-end h-5">
          <span>.output</span>
          <Handle type="source" id="output" position={Position.Right}
            style={{ right: -16, top: '50%', transform: 'translateY(-50%)' }}
            className="w-2.5 h-2.5 border-2 border-white !bg-zinc-900" />
        </div>
      </div>
    </div>
  )
}
export default memo(SeedNode)
