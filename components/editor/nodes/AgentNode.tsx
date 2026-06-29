'use client'
import React, { memo } from 'react'
import { Handle, Position, type NodeProps, type Node } from '@xyflow/react'
import type { EditorNodeData } from '../nodeData'
import { statusDotClass } from '../nodeData'

function AgentNode({ data, selected }: NodeProps<Node<EditorNodeData>>) {
  const { node, inputs, outputs, run, issues } = data
  const kindLabel = node.kind === 'decider' ? 'Decider' : 'Agent'
  return (
    <div className={`relative rounded-lg shadow-md border-2 min-w-[240px] bg-white ${run?.status === 'skipped' ? 'opacity-60' : ''} ${issues.length ? 'border-red-400' : selected ? 'border-zinc-900 ring-4 ring-zinc-900/5' : 'border-zinc-200'}`}>
      <div className="px-4 py-2 border-b border-zinc-100 bg-zinc-50/50 rounded-t-lg">
        <div className="flex items-center gap-2 mb-0.5">
          <div className={`w-2 h-2 rounded-full ${statusDotClass(run)}`} />
          <span className="text-[9px] font-bold text-zinc-400 uppercase tracking-widest">{kindLabel}</span>
          <div className="ml-auto flex items-center gap-1.5">
            {issues.length > 0 && <span className="text-[9px] font-bold text-red-500">{issues.length}!</span>}
            <button
              onClick={() => data.onRunFromHere?.(node.id)}
              title="Run up to here"
              className="nodrag text-[9px] font-bold text-zinc-400 hover:text-zinc-900"
            >
              ▶ here
            </button>
          </div>
        </div>
        <div className="text-xs font-bold text-zinc-900">{node.id}</div>
      </div>

      <div className="px-4 py-2">
        <select
          value={node.agent ?? ''}
          onChange={e => data.onChange({ agent: e.target.value })}
          className="w-full text-xs border border-zinc-200 rounded px-2 py-1 nodrag mb-2"
        >
          <option value="">— pick an agent —</option>
          {data.agents.map(a => <option key={a.slug} value={a.slug}>{a.name}</option>)}
        </select>

        {node.agent && (
          <button
            onClick={() => data.onEditAgent?.(node.agent!)}
            className="nodrag mb-2 text-[10px] font-bold text-zinc-500 hover:text-zinc-900 uppercase tracking-widest"
          >
            Edit agent →
          </button>
        )}

        <div className="flex justify-between gap-4 text-[9px] font-mono text-zinc-400">
          <div className="flex flex-col gap-1.5">
            {inputs.map(s => (
              <div key={s} className="relative pl-3 flex items-center h-5">
                <Handle type="target" id={s} position={Position.Left}
                  style={{ left: -16, top: '50%', transform: 'translateY(-50%)' }}
                  className="w-2.5 h-2.5 border-2 border-white !bg-zinc-400" />
                <span className="truncate max-w-[100px]" title={s}>{s}</span>
              </div>
            ))}
          </div>
          <div className="flex flex-col gap-1.5 text-right">
            {outputs.map(s => (
              <div key={s} className="relative pr-3 flex items-center justify-end h-5">
                <span className="truncate max-w-[100px]" title={`.${s}`}>.{s}</span>
                <Handle type="source" id={s} position={Position.Right}
                  style={{ right: -16, top: '50%', transform: 'translateY(-50%)' }}
                  className="w-2.5 h-2.5 border-2 border-white !bg-zinc-900" />
              </div>
            ))}
          </div>
        </div>

        {run && run.output && (
          <div className="mt-2 text-[10px] text-zinc-600 bg-zinc-50 border border-zinc-100 rounded p-2 max-h-24 overflow-hidden whitespace-pre-wrap">
            {run.output.slice(0, 240)}
          </div>
        )}
      </div>
    </div>
  )
}
export default memo(AgentNode)
