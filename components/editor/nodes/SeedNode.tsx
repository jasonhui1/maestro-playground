'use client'
import React, { memo } from 'react'
import { type NodeProps, type Node } from '@xyflow/react'
import type { EditorNodeDataOf } from '../nodeData'
import { Sockets } from './Sockets'

function SeedNode({ data }: NodeProps<Node<EditorNodeDataOf<'seed'>>>) {
  return (
    <div className="relative rounded-lg shadow-md border-2 border-zinc-200 bg-white min-w-[160px]">
      <div className="px-4 py-2 border-b border-zinc-100 bg-zinc-50/50 rounded-t-lg">
        <span className="text-xs font-semibold text-zinc-500 uppercase tracking-wider">Seed</span>
        <div className="text-xs font-bold text-zinc-900">{data.node.id}</div>
      </div>
      <div className="px-4 py-2">
        <Sockets handles={data.sockets} />
      </div>
    </div>
  )
}
export default memo(SeedNode)
