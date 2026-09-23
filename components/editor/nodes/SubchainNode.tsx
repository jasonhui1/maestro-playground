'use client'
import React, { memo } from 'react'
import Link from 'next/link'
import { type NodeProps, type Node } from '@xyflow/react'
import type { EditorNodeDataOf } from '../nodeData'
import { statusDotClass } from '../nodeData'
import { Sockets } from './Sockets'

function SubchainNode({ data, selected }: NodeProps<Node<EditorNodeDataOf<'subchain'>>>) {
  const { node, run, issues } = data
  return (
    <div className={`relative rounded-lg shadow-md border-2 min-w-[240px] bg-white ${issues.length ? 'border-red-400' : selected ? 'border-zinc-900 ring-4 ring-zinc-900/5' : 'border-indigo-300'}`}>
      <div className="px-4 py-2 border-b border-zinc-100 bg-indigo-50/50 rounded-t-lg flex items-center gap-2">
        <div className={`w-2 h-2 rounded-full ${statusDotClass(run)}`} />
        <span className="text-xs font-semibold text-indigo-500 uppercase tracking-wider">Subchain</span>
        {node.subchain && (
          <Link href={`/workspace?type=chain&slug=${encodeURIComponent(node.subchain)}`} className="nodrag ml-auto text-xs font-medium text-zinc-500 hover:text-zinc-900">Open chain →</Link>
        )}
      </div>
      <div className="px-4 py-2">
        <select
          value={node.subchain ?? ''}
          onChange={e => data.onChange({ subchain: e.target.value })}
          disabled={data.readOnly}
          className="w-full text-xs border border-zinc-200 rounded px-2 py-1 nodrag mb-2 disabled:bg-zinc-50 disabled:text-zinc-500"
        >
          <option value="">— pick a chain —</option>
          {data.chains.map(c => <option key={c.slug} value={c.slug}>{c.name}</option>)}
        </select>
        <Sockets handles={data.sockets} />
      </div>
    </div>
  )
}
export default memo(SubchainNode)
