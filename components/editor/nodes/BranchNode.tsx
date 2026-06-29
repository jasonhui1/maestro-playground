'use client'
import React, { memo } from 'react'
import { Handle, Position, type NodeProps, type Node } from '@xyflow/react'
import type { BranchCase } from '@/lib/types'
import type { EditorNodeData } from '../nodeData'
import { statusDotClass } from '../nodeData'

function BranchNode({ data, selected }: NodeProps<Node<EditorNodeData>>) {
  const { node, run, issues } = data
  const cases: BranchCase[] = node.cases ?? []

  const setCase = (i: number, patch: Partial<BranchCase>) =>
    data.onChange({ cases: cases.map((c, j) => j === i ? { ...c, ...patch } : c) })
  const addCase = () => data.onChange({ cases: [...cases, { label: `case-${cases.length + 1}`, condition: '' }] })
  const removeCase = (i: number) => data.onChange({ cases: cases.filter((_, j) => j !== i) })

  return (
    <div className={`relative rounded-lg shadow-md border-2 min-w-[260px] bg-white ${issues.length ? 'border-red-400' : selected ? 'border-zinc-900 ring-4 ring-zinc-900/5' : 'border-zinc-200'}`}>
      <div className="px-4 py-2 border-b border-zinc-100 bg-zinc-50/50 rounded-t-lg flex items-center gap-2">
        <div className={`w-2.5 h-2.5 rounded-full ${statusDotClass(run)}`} />
        <span className="text-[9px] font-bold text-zinc-400 uppercase tracking-widest">Branch</span>
        <span className="text-xs font-bold text-zinc-900 ml-1">{node.id}</span>
        <button
          onClick={() => data.onRunFromHere?.(node.id)}
          title="Run up to here"
          className="nodrag ml-auto text-[9px] font-bold text-zinc-400 hover:text-zinc-900"
        >
          ▶ here
        </button>
      </div>
      <div className="px-4 py-2">
        <div className="relative pl-3 flex items-center h-5 text-[9px] font-mono text-zinc-400 mb-2">
          <Handle type="target" id="in" position={Position.Left}
            style={{ left: -16, top: '50%', transform: 'translateY(-50%)' }}
            className="w-2.5 h-2.5 border-2 border-white !bg-zinc-400" />
          <span>in</span>
        </div>

        <div className="space-y-1.5">
          {/* Using index as key is necessary because items are editable objects; using unique field values like label as key would cause text inputs to lose focus on every keystroke. */}
          {cases.map((c, i) => (
            <div key={i} className="relative flex items-center gap-1">
              <input value={c.label} onChange={e => setCase(i, { label: e.target.value })}
                className="w-16 text-[10px] font-mono border border-zinc-200 rounded px-1 py-0.5 nodrag" />
              <input value={c.condition} onChange={e => setCase(i, { condition: e.target.value })}
                placeholder="condition" className="flex-1 text-[10px] font-mono border border-zinc-200 rounded px-1 py-0.5 nodrag" />
              <button onClick={() => removeCase(i)} className="text-zinc-300 hover:text-red-500 text-xs nodrag">×</button>
              <Handle type="source" id={c.label} position={Position.Right}
                style={{ right: -16, top: '50%', transform: 'translateY(-50%)' }}
                className="w-2.5 h-2.5 border-2 border-white !bg-zinc-900" />
            </div>
          ))}
        </div>

        <button onClick={addCase} className="mt-2 text-[10px] font-bold text-zinc-500 hover:text-zinc-900 nodrag">+ case</button>

        <div className="mt-2 relative flex items-center gap-1 text-[10px] font-mono text-zinc-400">
          <span className="w-16">default</span>
          <input value={node.default ?? ''} onChange={e => data.onChange({ default: e.target.value })}
            placeholder="default label" className="flex-1 text-[10px] font-mono border border-zinc-200 rounded px-1 py-0.5 nodrag" />
          {node.default && (
            <Handle type="source" id={node.default} position={Position.Right}
              style={{ right: -16, top: '50%', transform: 'translateY(-50%)' }}
              className="w-2.5 h-2.5 border-2 border-white !bg-zinc-500" />
          )}
        </div>
      </div>
    </div>
  )
}
export default memo(BranchNode)
