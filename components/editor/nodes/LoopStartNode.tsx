'use client'
import React, { memo } from 'react'
import { Handle, Position, type NodeProps, type Node } from '@xyflow/react'
import type { EditorNodeData } from '../nodeData'

function LoopStartNode({ data, selected }: NodeProps<Node<EditorNodeData>>) {
  const { node, issues } = data
  const state = node.state ?? []
  const setName = (i: number, name: string) => data.onChange({ state: state.map((s, j) => j === i ? name : s) })
  const addName = () => data.onChange({ state: [...state, `state-${state.length + 1}`] })
  const removeName = (i: number) => data.onChange({ state: state.filter((_, j) => j !== i) })

  return (
    <div className={`relative rounded-lg shadow-md border-2 min-w-[220px] bg-amber-50/40 ${issues.length ? 'border-red-400' : selected ? 'border-amber-600 ring-4 ring-amber-600/10' : 'border-amber-300'}`}>
      <div className="px-4 py-2 border-b border-amber-200 rounded-t-lg flex items-center gap-2">
        <span className="text-[9px] font-bold text-amber-600 uppercase tracking-widest">Loop start</span>
        <span className="text-xs font-bold text-zinc-900 ml-1">{node.id}</span>
      </div>
      <div className="px-4 py-2">
        <label className="block text-[9px] font-bold text-zinc-400 uppercase tracking-widest mb-1">zone</label>
        <input value={node.zone ?? ''} onChange={e => data.onChange({ zone: e.target.value })}
          disabled={data.readOnly}
          className="w-full text-[11px] font-mono border border-zinc-200 rounded px-2 py-1 nodrag mb-2 disabled:bg-zinc-50 disabled:text-zinc-500" />

        <div className="space-y-1">
          {/* Using index as key is necessary because items are editable strings; using the value as key would cause text inputs to lose focus on every keystroke. */}
          {state.map((s, i) => (
            <div key={i} className="relative flex items-center gap-1 text-[10px] font-mono text-zinc-400">
              <Handle type="target" id={s} position={Position.Left}
                style={{ left: -16, top: '50%', transform: 'translateY(-50%)' }}
                className="w-2.5 h-2.5 border-2 border-white !bg-amber-400" />
              <input value={s} onChange={e => setName(i, e.target.value)}
                disabled={data.readOnly}
                className="flex-1 text-[10px] font-mono border border-zinc-200 rounded px-1 py-0.5 nodrag disabled:bg-zinc-50 disabled:text-zinc-500" />
              {!data.readOnly && (
                <button onClick={() => removeName(i)} className="text-zinc-300 hover:text-red-500 text-xs nodrag">×</button>
              )}
              <Handle type="source" id={s} position={Position.Right}
                style={{ right: -16, top: '50%', transform: 'translateY(-50%)' }}
                className="w-2.5 h-2.5 border-2 border-white !bg-amber-500" />
            </div>
          ))}
        </div>
        {!data.readOnly && (
          <button onClick={addName} className="mt-2 text-[10px] font-bold text-zinc-500 hover:text-zinc-900 nodrag">+ state</button>
        )}
      </div>
    </div>
  )
}
export default memo(LoopStartNode)
