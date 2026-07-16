'use client'
import React, { memo } from 'react'
import { Handle, Position, type NodeProps, type Node } from '@xyflow/react'
import { GitMerge } from 'lucide-react'
import type { EditorNodeData } from '../nodeData'
import { statusDotClass } from '../nodeData'

function JoinNode({ data, selected }: NodeProps<Node<EditorNodeData>>) {
  const { node, inputs, outputs, run, issues } = data
  return (
    <div className={`relative rounded-lg shadow-md border-2 min-w-[220px] bg-white ${run?.status === 'skipped' ? 'opacity-60' : ''} ${issues.length ? 'border-red-400' : selected ? 'border-zinc-900 ring-4 ring-zinc-900/5' : 'border-zinc-200'}`}>
      <div className="px-4 py-2 border-b border-zinc-100 bg-zinc-50/50 rounded-t-lg flex items-center gap-2">
        <div className={`w-2.5 h-2.5 rounded-full ${statusDotClass(run)}`} />
        <GitMerge className="w-3.5 h-3.5 text-zinc-400" />
        <span className="text-[9px] font-bold text-zinc-400 uppercase tracking-widest">Join</span>
        <span className="text-xs font-bold text-zinc-900 ml-1">{node.id}</span>
        {issues.length > 0 && <span className="ml-auto text-[9px] font-bold text-red-500">{issues.length}!</span>}
      </div>
      <div className="px-4 py-2">
        {run?.output ? (
          <div className="text-[10px] text-zinc-600 font-mono line-clamp-4 break-all bg-zinc-50 p-1.5 rounded border border-zinc-100">
            {run.output}
          </div>
        ) : (
          <div className="text-[10px] text-zinc-400 italic">Merges all inputs, labeled</div>
        )}
        <div className="mt-2 flex justify-between gap-4 text-[9px] font-mono text-zinc-400">
          <div className="flex flex-col gap-1.5">
            {inputs.map(s => (
              <div key={s} className="relative pl-3 flex items-center h-5">
                <Handle type="target" id={s} position={Position.Left}
                  style={{ left: -16, top: '50%', transform: 'translateY(-50%)' }}
                  className="w-2.5 h-2.5 border-2 border-white !bg-zinc-400" />
                <span>{s}</span>
              </div>
            ))}
          </div>
          <div className="flex flex-col gap-1.5 text-right">
            {outputs.map(s => (
              <div key={s} className="relative pr-3 flex items-center justify-end h-5">
                <span>.{s}</span>
                <Handle type="source" id={s} position={Position.Right}
                  style={{ right: -16, top: '50%', transform: 'translateY(-50%)' }}
                  className="w-2.5 h-2.5 border-2 border-white !bg-zinc-900" />
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}
export default memo(JoinNode)
