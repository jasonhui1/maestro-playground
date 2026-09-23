'use client'
import React, { memo } from 'react'
import { type NodeProps, type Node } from '@xyflow/react'
import type { BranchCase } from '@/lib/types'
import { handleNamed, inputHandles } from '@/lib/nodeSockets'
import type { EditorNodeDataOf } from '../nodeData'
import { statusDotClass } from '../nodeData'
import { SocketDot, SocketList } from './Sockets'

function BranchNode({ data, selected }: NodeProps<Node<EditorNodeDataOf<'branch'>>>) {
  const { node, run, issues } = data
  const cases: BranchCase[] = node.cases ?? []
  // A case's output socket is named by its label, so its dot rides that case's own row
  // and stays readable as the edge's source.
  const outFor = (label: string) => handleNamed(data.sockets, 'output', label)
  const defaultOut = node.default ? outFor(node.default) : undefined

  const setCase = (i: number, patch: Partial<BranchCase>) =>
    data.onChange({ cases: cases.map((c, j) => j === i ? { ...c, ...patch } : c) })
  const addCase = () => data.onChange({ cases: [...cases, { label: `case-${cases.length + 1}`, condition: '' }] })
  const removeCase = (i: number) => data.onChange({ cases: cases.filter((_, j) => j !== i) })

  return (
    <div className={`relative rounded-lg shadow-md border-2 min-w-[260px] bg-white ${issues.length ? 'border-red-400' : selected ? 'border-zinc-900 ring-4 ring-zinc-900/5' : 'border-zinc-200'}`}>
      <div className="px-4 py-2 border-b border-zinc-100 bg-zinc-50/50 rounded-t-lg flex items-center gap-2">
        <div className={`w-2.5 h-2.5 rounded-full ${statusDotClass(run)}`} />
        <span className="text-xs font-semibold text-zinc-500 uppercase tracking-wider">Branch</span>
        <span className="text-xs font-bold text-zinc-900 ml-1">{node.id}</span>
        {!data.readOnly && (
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
        <div className="text-xs font-mono text-zinc-500 mb-2">
          <SocketList handles={inputHandles(data.sockets)} />
        </div>

        <div className="space-y-1.5">
          {/* Using index as key is necessary because items are editable objects; using unique field values like label as key would cause text inputs to lose focus on every keystroke. */}
          {cases.map((c, i) => {
            const out = outFor(c.label)
            return (
              <div key={i} className="relative flex items-center gap-1">
                <input value={c.label} onChange={e => setCase(i, { label: e.target.value })}
                  disabled={data.readOnly}
                  className="w-16 text-xs font-mono border border-zinc-200 rounded px-1 py-0.5 nodrag disabled:bg-zinc-50 disabled:text-zinc-500" />
                <input value={c.condition} onChange={e => setCase(i, { condition: e.target.value })}
                  placeholder="condition"
                  disabled={data.readOnly}
                  className="flex-1 text-xs font-mono border border-zinc-200 rounded px-1 py-0.5 nodrag disabled:bg-zinc-50 disabled:text-zinc-500" />
                {!data.readOnly && (
                  <button onClick={() => removeCase(i)} className="text-zinc-300 hover:text-red-500 text-xs nodrag">×</button>
                )}
                {out && <SocketDot handle={out} />}
              </div>
            )
          })}
        </div>

        {!data.readOnly && (
          <button onClick={addCase} className="mt-2 text-xs font-semibold text-zinc-500 hover:text-zinc-900 nodrag">+ case</button>
        )}

        <div className="mt-2 relative flex items-center gap-1 text-xs font-mono text-zinc-500">
          <span className="w-16">default</span>
          <input value={node.default ?? ''} onChange={e => data.onChange({ default: e.target.value })}
            placeholder="default label"
            disabled={data.readOnly}
            className="flex-1 text-xs font-mono border border-zinc-200 rounded px-1 py-0.5 nodrag disabled:bg-zinc-50 disabled:text-zinc-500" />
          {defaultOut && <SocketDot handle={defaultOut} tone="muted" />}
        </div>
      </div>
    </div>
  )
}
export default memo(BranchNode)
