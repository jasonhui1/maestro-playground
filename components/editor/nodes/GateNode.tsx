'use client'
import React, { memo } from 'react'
import { Handle, Position, type NodeProps, type Node } from '@xyflow/react'
import type { EditorNodeDataOf } from '../nodeData'
import { statusDotClass } from '../nodeData'

function GateNode({ data, selected }: NodeProps<Node<EditorNodeDataOf<'gate'>>>) {
  const { node, run, issues } = data
  return (
    <div className={`relative rounded-lg shadow-md border-2 min-w-[220px] bg-white ${issues.length ? 'border-red-400' : selected ? 'border-zinc-900 ring-4 ring-zinc-900/5' : 'border-zinc-200'}`}>
      <div className="px-4 py-2 border-b border-zinc-100 bg-zinc-50/50 rounded-t-lg flex items-center gap-2">
        <div className={`w-2.5 h-2.5 rounded-full ${statusDotClass(run)}`} />
        <span className="text-[9px] font-bold text-zinc-400 uppercase tracking-widest">Gate</span>
        <span className="text-xs font-bold text-zinc-900 ml-1">{node.id}</span>
        {!data.readOnly && (
          <button
            onClick={() => data.onRunFromHere?.(node.id)}
            title="Run up to here"
            className="nodrag ml-auto text-[9px] font-bold text-zinc-400 hover:text-zinc-900"
          >
            ▶ here
          </button>
        )}
      </div>
      <div className="px-4 py-2">
        <input
          value={node.condition ?? ''}
          onChange={e => data.onChange({ condition: e.target.value })}
          placeholder='e.g. {x.output} contains "OK"'
          disabled={data.readOnly}
          className="w-full text-[11px] font-mono border border-zinc-200 rounded px-2 py-1 nodrag mb-2 disabled:bg-zinc-50 disabled:text-zinc-500"
        />
        <div className="flex justify-between text-[9px] font-mono text-zinc-400">
          <div className="relative pl-3 flex items-center h-5">
            <Handle type="target" id="in" position={Position.Left}
              style={{ left: -16, top: '50%', transform: 'translateY(-50%)' }}
              className="w-2.5 h-2.5 border-2 border-white !bg-zinc-400" />
            <span>in</span>
          </div>
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
export default memo(GateNode)
