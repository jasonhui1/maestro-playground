'use client'
import React, { memo } from 'react'
import { Handle, Position, type NodeProps, type Node } from '@xyflow/react'
import type { EditorNodeData } from '../nodeData'
import { statusDotClass, type NodeOfKind } from '../nodeData'

function LoopEndNode({ data, selected }: NodeProps<Node<EditorNodeData>>) {
  const node = data.node as NodeOfKind<'loop-end'>
  const { inputs, outputs, run, issues } = data
  return (
    <div className={`relative rounded-lg shadow-md border-2 min-w-[220px] bg-amber-50/40 ${issues.length ? 'border-red-400' : selected ? 'border-amber-600 ring-4 ring-amber-600/10' : 'border-amber-300'}`}>
      <div className="px-4 py-2 border-b border-amber-200 rounded-t-lg flex items-center gap-2">
        <div className={`w-2.5 h-2.5 rounded-full ${statusDotClass(run)}`} />
        <span className="text-[9px] font-bold text-amber-600 uppercase tracking-widest">Loop end</span>
        <span className="text-xs font-bold text-zinc-900 ml-1">{node.id}</span>
      </div>
      <div className="px-4 py-2">
        <label className="block text-[9px] font-bold text-zinc-400 uppercase tracking-widest mb-1">zone</label>
        <input value={node.zone ?? ''} onChange={e => data.onChange({ zone: e.target.value })}
          disabled={data.readOnly}
          className="w-full text-[11px] font-mono border border-zinc-200 rounded px-2 py-1 nodrag mb-2 disabled:bg-zinc-50 disabled:text-zinc-500" />
        <label className="block text-[9px] font-bold text-zinc-400 uppercase tracking-widest mb-1">until</label>
        <input value={node.until ?? ''} onChange={e => data.onChange({ until: e.target.value })}
          placeholder='e.g. {ls.draft} contains "DONE"'
          disabled={data.readOnly}
          className="w-full text-[11px] font-mono border border-zinc-200 rounded px-2 py-1 nodrag mb-2 disabled:bg-zinc-50 disabled:text-zinc-500" />
        <label className="block text-[9px] font-bold text-zinc-400 uppercase tracking-widest mb-1">max iterations</label>
        <input type="number" min={1} value={node.maxIterations ?? 1}
          onChange={e => data.onChange({ maxIterations: parseInt(e.target.value) || 1 })}
          disabled={data.readOnly}
          className="w-full text-[11px] font-mono border border-zinc-200 rounded px-2 py-1 nodrag mb-2 disabled:bg-zinc-50 disabled:text-zinc-500" />

        <div className="flex justify-between gap-4 text-[9px] font-mono text-zinc-400">
          <div className="flex flex-col gap-1.5">
            {inputs.map(s => (
              <div key={s} className="relative pl-3 flex items-center h-5">
                <Handle type="target" id={s} position={Position.Left}
                  style={{ left: -16, top: '50%', transform: 'translateY(-50%)' }}
                  className="w-2.5 h-2.5 border-2 border-white !bg-amber-400" />
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
                  className="w-2.5 h-2.5 border-2 border-white !bg-amber-500" />
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}
export default memo(LoopEndNode)
