'use client'
import { memo } from 'react'
import { type NodeProps, type Node } from '@xyflow/react'
import type { EditorNodeDataOf } from '../nodeData'
import { statusDotClass } from '../nodeData'
import { Sockets } from './Sockets'

function ToolNode({ data, selected }: NodeProps<Node<EditorNodeDataOf<'tool'>>>) {
  return (
    <div className={`rounded-lg border-2 bg-white min-w-[220px] ${data.issues.length ? 'border-red-400' : selected ? 'border-zinc-900' : 'border-zinc-200'}`}>
      <div className="px-4 py-2 border-b border-zinc-100 flex items-center gap-2">
        <div className={`w-2.5 h-2.5 rounded-full ${statusDotClass(data.run)}`} />
        <span className="text-xs text-zinc-500">Tool</span>
        <span className="text-xs font-semibold">{data.node.tool || data.node.id}</span>
      </div>
      <div className="px-4 py-2"><Sockets handles={data.sockets} /></div>
    </div>
  )
}
export default memo(ToolNode)
