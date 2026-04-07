'use client'
import { ChainDef } from '@/lib/types'

interface Props {
  chains: ChainDef[]
  selected: string
  onChange: (name: string) => void
}

export function ChainSelector({ chains, selected, onChange }: Props) {
  return (
    <div className="flex flex-col gap-1">
      <label className="text-xs font-medium text-zinc-500 uppercase tracking-wide">
        Chain
      </label>
      <select
        value={selected}
        onChange={e => onChange(e.target.value)}
        className="rounded-lg border border-zinc-200 bg-white px-3 py-2 text-sm"
      >
        {chains.map(c => (
          <option key={c.name} value={c.name}>{c.name}</option>
        ))}
      </select>
    </div>
  )
}
