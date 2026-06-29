'use client'
import React, { memo } from 'react'
import { Handle, Position, type NodeProps, type Node } from '@xyflow/react'
import type { EditorNodeData } from '../nodeData'
import { statusDotClass } from '../nodeData'

function SubchainNode({ data, selected }: NodeProps<Node<EditorNodeData>>) {
  const { node, inputs, outputs, run, issues } = data
  return (
    <div className={`relative rounded-lg shadow-md border-2 min-w-[240px] bg-white ${issues.length ? 'border-red-400' : selected ? 'border-zinc-900 ring-4 ring-zinc-900/5' : 'border-indigo-300'}`}>
      <div className="px-4 py-2 border-b border-zinc-100 bg-indigo-50/50 rounded-t-lg flex items-center gap-2">
        <div className={`w-2 h-2 rounded-full ${statusDotClass(run)}`} />
        <span className="text-[9px] font-bold text-indigo-400 uppercase tracking-widest">Subchain</span>
        {node.subchain && (
          <a href={`/workspace?type=chain&slug=${node.subchain}`} className="nodrag ml-auto text-[9px] font-bold text-zinc-400 hover:text-zinc-900">Open chain →</a>
        )}
      </div>
      <div className="px-4 py-2">
        <select
          value={node.subchain ?? ''}
          onChange={e => data.onChange({ subchain: e.target.value })}
          className="w-full text-xs border border-zinc-200 rounded px-2 py-1 nodrag mb-2"
        >
          <option value="">— pick a chain —</option>
          {data.chains.map(c => <option key={c.slug} value={c.slug}>{c.name}</option>)}
        </select>
        <div className="flex justify-between gap-4 text-[9px] font-mono text-zinc-400">
          <div className="flex flex-col gap-1.5">
            {inputs.map(s => (
              <div key={s} className="relative pl-3 flex items-center h-5">
                <Handle type="target" id={s} position={Position.Left} style={{ left: -16, top: '50%', transform: 'translateY(-50%)' }} className="w-2.5 h-2.5 border-2 border-white !bg-zinc-400" />
                <span className="truncate max-w-[100px]" title={s}>{s}</span>
              </div>
            ))}
          </div>
          <div className="flex flex-col gap-1.5 text-right">
            {outputs.map(s => (
              <div key={s} className="relative pr-3 flex items-center justify-end h-5">
                <span className="truncate max-w-[100px]" title={`.${s}`}>.{s}</span>
                <Handle type="source" id={s} position={Position.Right} style={{ right: -16, top: '50%', transform: 'translateY(-50%)' }} className="w-2.5 h-2.5 border-2 border-white !bg-zinc-900" />
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}
export default memo(SubchainNode)
