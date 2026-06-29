'use client'
import React from 'react'
import type { ChainNode, ChainPort } from '@/lib/types'
import { Plus, X } from 'lucide-react'

export default function InterfacePanel({ nodes, inputs, outputs, onChange }: {
  nodes: ChainNode[]
  inputs: ChainPort[]
  outputs: ChainPort[]
  onChange: (iface: { inputs: ChainPort[]; outputs: ChainPort[] }) => void
}) {
  const seeds = nodes.filter(n => n.kind === 'seed')
  const set = (next: Partial<{ inputs: ChainPort[]; outputs: ChainPort[] }>) =>
    onChange({ inputs, outputs, ...next })

  const Row = ({ port, i, kind }: { port: ChainPort; i: number; kind: 'inputs' | 'outputs' }) => {
    const list = kind === 'inputs' ? inputs : outputs
    const update = (patch: Partial<ChainPort>) => {
      const copy = list.map((p, j) => (j === i ? { ...p, ...patch } : p))
      set({ [kind]: copy } as any)
    }
    const remove = () => set({ [kind]: list.filter((_, j) => j !== i) } as any)
    return (
      <div className="flex items-center gap-1.5 mb-1">
        <input
          value={port.name}
          onChange={e => update({ name: e.target.value })}
          placeholder="socket name"
          className="w-24 text-[11px] border border-zinc-200 rounded px-1.5 py-0.5"
        />
        <span className="text-[10px] text-zinc-400">→</span>
        <select
          value={port.node}
          onChange={e => update({ node: e.target.value })}
          className="flex-1 text-[11px] border border-zinc-200 rounded px-1.5 py-0.5"
        >
          <option value="">— node —</option>
          {(kind === 'inputs' ? seeds : nodes).map(n => <option key={n.id} value={n.id}>{n.id}</option>)}
        </select>
        <button onClick={remove} className="text-zinc-300 hover:text-red-500"><X size={12} /></button>
      </div>
    )
  }

  return (
    <div className="border-t border-zinc-200 bg-white px-4 py-2 text-[11px]">
      <div className="grid grid-cols-2 gap-4">
        <div>
          <div className="flex items-center justify-between mb-1">
            <span className="text-[9px] font-bold text-zinc-400 uppercase tracking-widest">Inputs</span>
            <button onClick={() => set({ inputs: [...inputs, { name: '', node: seeds[0]?.id ?? '' }] })} className="text-zinc-400 hover:text-zinc-700"><Plus size={12} /></button>
          </div>
          {inputs.map((p, i) => <Row key={i} port={p} i={i} kind="inputs" />)}
        </div>
        <div>
          <div className="flex items-center justify-between mb-1">
            <span className="text-[9px] font-bold text-zinc-400 uppercase tracking-widest">Outputs</span>
            <button onClick={() => set({ outputs: [...outputs, { name: '', node: '' }] })} className="text-zinc-400 hover:text-zinc-700"><Plus size={12} /></button>
          </div>
          {outputs.map((p, i) => <Row key={i} port={p} i={i} kind="outputs" />)}
        </div>
      </div>
    </div>
  )
}
