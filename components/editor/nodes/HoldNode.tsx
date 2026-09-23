'use client'
import React, { memo } from 'react'
import { type NodeProps, type Node } from '@xyflow/react'
import { Hand } from 'lucide-react'
import type { EditorNodeDataOf } from '../nodeData'
import { statusDotClass } from '../nodeData'
import { Sockets } from './Sockets'

function HoldNode({ data, selected }: NodeProps<Node<EditorNodeDataOf<'hold'>>>) {
  const { node, run, issues } = data
  return (
    <div className={`relative rounded-lg shadow-md border-2 min-w-[220px] bg-white ${issues.length ? 'border-red-400' : selected ? 'border-zinc-900 ring-4 ring-zinc-900/5' : 'border-zinc-200'}`}>
      <div className="px-4 py-2 border-b border-zinc-100 bg-zinc-50/50 rounded-t-lg flex items-center gap-2">
        <div className={`w-2.5 h-2.5 rounded-full ${statusDotClass(run)}`} />
        <Hand className="w-3.5 h-3.5 text-zinc-400" />
        <span className="text-xs font-semibold text-zinc-500 uppercase tracking-wider">Hold</span>
        <span className="text-xs font-bold text-zinc-900 ml-1">{node.id}</span>
        {issues.length > 0 && <span className="ml-auto text-xs font-bold text-red-500">{issues.length}!</span>}
      </div>
      <div className="px-4 py-2">
        <input
          value={node.prompt ?? ''}
          onChange={e => data.onChange({ prompt: e.target.value || undefined })}
          placeholder="Prompt shown to you (optional)"
          disabled={data.readOnly}
          className="w-full text-xs border border-zinc-200 rounded px-2 py-1 nodrag mb-2 disabled:bg-zinc-50 disabled:text-zinc-500"
        />
        <Sockets handles={data.sockets} />
      </div>
    </div>
  )
}
export default memo(HoldNode)
