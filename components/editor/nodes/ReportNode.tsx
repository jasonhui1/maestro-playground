'use client'
import React, { memo } from 'react'
import { type NodeProps, type Node } from '@xyflow/react'
import { FileText } from 'lucide-react'
import type { EditorNodeDataOf } from '../nodeData'
import { statusDotClass } from '../nodeData'
import { Sockets } from './Sockets'

function ReportNode({ data, selected }: NodeProps<Node<EditorNodeDataOf<'report'>>>) {
  const { node, run, issues } = data
  return (
    <div className={`relative rounded-lg shadow-md border-2 min-w-[220px] bg-white ${issues.length ? 'border-red-400' : selected ? 'border-zinc-900 ring-4 ring-zinc-900/5' : 'border-zinc-200'}`}>
      <div className="px-4 py-2 border-b border-zinc-100 bg-zinc-50/50 rounded-t-lg flex items-center gap-2">
        <div className={`w-2.5 h-2.5 rounded-full ${statusDotClass(run)}`} />
        <FileText className="w-3.5 h-3.5 text-zinc-400" />
        <span className="text-xs font-semibold text-zinc-500 uppercase tracking-wider">Report</span>
        <span className="text-xs font-bold text-zinc-900 ml-1">{node.id}</span>
        {!data.readOnly && data.onRunFromHere && (
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
        {run?.output ? (
          <div className="text-xs text-zinc-600 font-mono line-clamp-4 break-all bg-zinc-50 p-1.5 rounded border border-zinc-100">
            {run.output}
          </div>
        ) : (
          <div className="text-xs text-zinc-400 italic">
            Display (no output yet)
          </div>
        )}
        <div className="mt-2">
          <Sockets handles={data.sockets} />
        </div>
      </div>
    </div>
  )
}
export default memo(ReportNode)
