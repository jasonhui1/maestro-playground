'use client'
import React, { memo } from 'react'
import { type NodeProps, type Node } from '@xyflow/react'
import type { EditorNodeDataOf } from '../nodeData'
import { statusDotClass } from '../nodeData'
import { Sockets } from './Sockets'

function AgentNode({ data, selected }: NodeProps<Node<EditorNodeDataOf<'agent' | 'decider'>>>) {
  const { node, run, issues } = data
  const kindLabel = node.kind === 'decider' ? 'Decider' : 'Agent'
  return (
    <div className={`relative rounded-lg shadow-md border-2 min-w-[240px] bg-white ${run?.status === 'skipped' ? 'opacity-60' : ''} ${issues.length ? 'border-red-400' : selected ? 'border-zinc-900 ring-4 ring-zinc-900/5' : 'border-zinc-200'}`}>
      <div className="px-4 py-2 border-b border-zinc-100 bg-zinc-50/50 rounded-t-lg">
        <div className="flex items-center gap-2 mb-0.5">
          <div className={`w-2 h-2 rounded-full ${statusDotClass(run)}`} />
          <span className="text-xs font-semibold text-zinc-500 uppercase tracking-wider">{kindLabel}</span>
          <div className="ml-auto flex items-center gap-1.5">
            {issues.length > 0 && <span className="text-xs font-bold text-red-500">{issues.length}!</span>}
            {!data.readOnly && (
              <button
                onClick={() => data.onRunFromHere?.(node.id)}
                title="Run up to here"
                className="nodrag text-xs font-medium text-zinc-600 hover:text-zinc-900 hover:bg-zinc-100 rounded px-1.5 py-0.5 transition-colors"
              >
                ▶ Run To
              </button>
            )}
          </div>
        </div>
        <div className="text-xs font-bold text-zinc-900">{node.id}</div>
      </div>

      <div className="px-4 py-2">
        <select
          value={node.agent ?? ''}
          onChange={e => data.onChange({ agent: e.target.value })}
          disabled={data.readOnly}
          className="w-full text-xs border border-zinc-200 hover:border-zinc-300 rounded px-2 py-1.5 nodrag mb-2 bg-white text-zinc-800 disabled:bg-zinc-50 disabled:text-zinc-500 focus:outline-none focus:ring-1 focus:ring-zinc-400 transition-colors"
        >
          <option value="">— pick an agent —</option>
          {data.agents.map(a => <option key={a.slug} value={a.slug}>{a.name}</option>)}
        </select>

        {node.agent && !data.readOnly && (
          <button
            onClick={() => data.onEditAgent?.(node.agent!)}
            className="nodrag mb-2 text-xs font-semibold text-zinc-500 hover:text-zinc-900 tracking-wider"
          >
            Edit agent →
          </button>
        )}

        <Sockets
          handles={data.sockets}
          node={node}
          onChange={data.onChange}
          readOnly={data.readOnly}
          wiredSockets={data.wiredSockets}
        />
      </div>
    </div>
  )
}
export default memo(AgentNode)
