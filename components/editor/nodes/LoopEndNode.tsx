'use client'
import React, { memo } from 'react'
import { type NodeProps, type Node } from '@xyflow/react'
import type { EditorNodeDataOf } from '../nodeData'
import { statusDotClass } from '../nodeData'
import { Sockets } from './Sockets'
import ZoneBadge from './ZoneBadge'

function LoopEndNode({ data, selected }: NodeProps<Node<EditorNodeDataOf<'loop-end'>>>) {
  const { node, run, issues } = data
  return (
    <div className={`relative rounded-lg shadow-md border-2 min-w-[220px] bg-amber-50/40 ${issues.length ? 'border-red-400' : selected ? 'border-amber-600 ring-4 ring-amber-600/10' : 'border-amber-300'}`}>
      <div className="px-4 py-2 border-b border-amber-200 rounded-t-lg flex items-center gap-2">
        <div className={`w-2.5 h-2.5 rounded-full ${statusDotClass(run)}`} />
        <span className="text-xs font-semibold text-amber-700 uppercase tracking-wider">Loop end</span>
        <span className="text-xs font-bold text-zinc-900 ml-1">{node.id}</span>
      </div>
      <div className="px-4 py-2">
        <label className="block text-xs font-semibold text-zinc-500 uppercase tracking-wider mb-1">zone</label>
        <ZoneBadge
          zone={node.zone}
          onChange={zone => data.onChange({ zone })}
          readOnly={data.readOnly}
          availableZones={data.availableZones}
        />
        <label className="block text-xs font-semibold text-zinc-500 uppercase tracking-wider mb-1">until</label>
        <input value={node.until ?? ''} onChange={e => data.onChange({ until: e.target.value })}
          placeholder='e.g. {ls.draft} contains "DONE"'
          disabled={data.readOnly}
          className="w-full text-xs font-mono border border-zinc-200 rounded-md px-2 py-1 nodrag mb-2 disabled:bg-zinc-50 disabled:text-zinc-500" />
        <label className="block text-xs font-semibold text-zinc-500 uppercase tracking-wider mb-1">max iterations</label>
        <input type="number" min={1} value={node.maxIterations ?? 1}
          onChange={e => data.onChange({ maxIterations: parseInt(e.target.value) || 1 })}
          disabled={data.readOnly}
          className="w-full text-xs font-mono border border-zinc-200 rounded-md px-2 py-1 nodrag mb-2 disabled:bg-zinc-50 disabled:text-zinc-500" />

        <Sockets handles={data.sockets} tone="loop" />
      </div>
    </div>
  )
}
export default memo(LoopEndNode)
