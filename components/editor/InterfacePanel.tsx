'use client'
import React from 'react'
import type { ChainNode, ChainPort } from '@/lib/types'
import { Plus, X } from 'lucide-react'

// Module-level so its identity is stable across InterfacePanel renders. A row
// component defined inside the parent would be a new type on every keystroke,
// remounting the <input> and dropping focus mid-edit.
function PortRow({ port, nodeOptions, onUpdate, onRemove }: {
  port: ChainPort
  nodeOptions: ChainNode[]
  onUpdate: (patch: Partial<ChainPort>) => void
  onRemove: () => void
}) {
  return (
    <div className="flex items-center gap-1.5 mb-1">
      <input
        value={port.name}
        onChange={e => onUpdate({ name: e.target.value })}
        placeholder="socket name"
        className="w-24 text-[11px] border border-zinc-200 rounded px-1.5 py-0.5"
      />
      <span className="text-[10px] text-zinc-400">→</span>
      <select
        value={port.node}
        onChange={e => onUpdate({ node: e.target.value })}
        className="flex-1 text-[11px] border border-zinc-200 rounded px-1.5 py-0.5"
      >
        <option value="">— node —</option>
        {nodeOptions.map(n => <option key={n.id} value={n.id}>{n.id}</option>)}
      </select>
      <button onClick={onRemove} className="text-zinc-300 hover:text-red-500"><X size={12} /></button>
    </div>
  )
}

export default function InterfacePanel({ nodes, inputs, outputs, onChange }: {
  nodes: ChainNode[]
  inputs: ChainPort[]
  outputs: ChainPort[]
  onChange: (iface: { inputs: ChainPort[]; outputs: ChainPort[] }) => void
}) {
  const seeds = nodes.filter(n => n.kind === 'seed')
  const set = (next: Partial<{ inputs: ChainPort[]; outputs: ChainPort[] }>) =>
    onChange({ inputs, outputs, ...next })

  const updateAt = (kind: 'inputs' | 'outputs', i: number, patch: Partial<ChainPort>) => {
    const list = kind === 'inputs' ? inputs : outputs
    set({ [kind]: list.map((p, j) => (j === i ? { ...p, ...patch } : p)) })
  }
  const removeAt = (kind: 'inputs' | 'outputs', i: number) => {
    const list = kind === 'inputs' ? inputs : outputs
    set({ [kind]: list.filter((_, j) => j !== i) })
  }

  return (
    <div className="border-t border-zinc-200 bg-white px-4 py-2 text-[11px]">
      <div className="grid grid-cols-2 gap-4">
        <div>
          <div className="flex items-center justify-between mb-1">
            <span className="text-[9px] font-bold text-zinc-400 uppercase tracking-widest">Inputs</span>
            <button onClick={() => set({ inputs: [...inputs, { name: '', node: seeds[0]?.id ?? '' }] })} className="text-zinc-400 hover:text-zinc-700"><Plus size={12} /></button>
          </div>
          {inputs.map((p, i) => (
            <PortRow key={i} port={p} nodeOptions={seeds} onUpdate={patch => updateAt('inputs', i, patch)} onRemove={() => removeAt('inputs', i)} />
          ))}
        </div>
        <div>
          <div className="flex items-center justify-between mb-1">
            <span className="text-[9px] font-bold text-zinc-400 uppercase tracking-widest">Outputs</span>
            <button onClick={() => set({ outputs: [...outputs, { name: '', node: '' }] })} className="text-zinc-400 hover:text-zinc-700"><Plus size={12} /></button>
          </div>
          {outputs.map((p, i) => (
            <PortRow key={i} port={p} nodeOptions={nodes} onUpdate={patch => updateAt('outputs', i, patch)} onRemove={() => removeAt('outputs', i)} />
          ))}
        </div>
      </div>
    </div>
  )
}
