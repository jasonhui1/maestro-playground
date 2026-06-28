'use client'
import React, { memo } from 'react'
import { Handle, Position, type NodeProps, type Node } from '@xyflow/react'
import type { EditorNodeData } from '../nodeData'

function ContextNode({ data }: NodeProps<Node<EditorNodeData>>) {
  return (
    <div className="relative rounded-lg shadow-md border-2 border-zinc-200 bg-white min-w-[200px]">
      <div className="px-4 py-2 border-b border-zinc-100 bg-zinc-50/50 rounded-t-lg">
        <span className="text-[9px] font-bold text-zinc-400 uppercase tracking-widest">Context</span>
        <div className="text-xs font-bold text-zinc-900">{data.node.id}</div>
      </div>
      <div className="px-4 py-2 space-y-2">
        <select
          value={data.node.file ?? ''}
          onChange={e => data.onChange({ file: e.target.value })}
          className="w-full text-xs border border-zinc-200 rounded px-2 py-1 nodrag"
        >
          <option value="">— pick a context file —</option>
          {data.contextFiles.map(f => <option key={f.slug} value={f.slug}>{f.name}</option>)}
        </select>
        <div className="flex justify-end text-[9px] font-mono text-zinc-400">
          <div className="relative pr-3 flex items-center justify-end h-5">
            <span>.output</span>
            <Handle type="source" id="output" position={Position.Right}
              style={{ right: -16, top: '50%', transform: 'translateY(-50%)' }}
              className="w-2.5 h-2.5 border-2 border-white !bg-zinc-900" />
          </div>
        </div>
      </div>
    </div>
  )
}
export default memo(ContextNode)
