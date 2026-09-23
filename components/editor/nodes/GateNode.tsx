'use client'
import React, { memo } from 'react'
import { type NodeProps, type Node } from '@xyflow/react'
import type { EditorNodeDataOf } from '../nodeData'
import { statusDotClass } from '../nodeData'
import { Sockets } from './Sockets'

function GateNode({ data, selected }: NodeProps<Node<EditorNodeDataOf<'gate'>>>) {
  const { node, run, issues } = data
  return (
    <div className={`relative rounded-lg shadow-md border-2 min-w-[220px] bg-white ${issues.length ? 'border-red-400' : selected ? 'border-zinc-900 ring-4 ring-zinc-900/5' : 'border-zinc-200'}`}>
      <div className="px-4 py-2 border-b border-zinc-100 bg-zinc-50/50 rounded-t-lg flex items-center gap-2">
        <div className={`w-2.5 h-2.5 rounded-full ${statusDotClass(run)}`} />
        <span className="text-xs font-semibold text-zinc-500 uppercase tracking-wider">Gate</span>
        <span className="text-xs font-bold text-zinc-900 ml-1">{node.id}</span>
        {!data.readOnly && (
          <button
            onClick={() => data.onRunFromHere?.(node.id)}
            title="Run up to here"
            className="nodrag ml-auto text-xs font-medium text-zinc-600 hover:text-zinc-900 hover:bg-zinc-100 rounded px-1.5 py-0.5 transition-colors"
          >
            ▶ Run To
          </button>
        )}
      </div>
      <div className="px-4 py-2">
        <input
          value={node.condition ?? ''}
          onChange={e => data.onChange({ condition: e.target.value })}
          placeholder='e.g. {x.output} contains "OK"'
          disabled={data.readOnly}
          className="w-full text-xs font-mono border border-zinc-200 rounded px-2 py-1 nodrag mb-2 disabled:bg-zinc-50 disabled:text-zinc-500"
        />
        <Sockets handles={data.sockets} />
      </div>
    </div>
  )
}
export default memo(GateNode)
