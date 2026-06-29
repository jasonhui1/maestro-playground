'use client'
import React, { useMemo, useState } from 'react'
import Fuse from 'fuse.js'
import type { ChainNodeKind } from '@/lib/types'
import { useWorkspaceUiStore } from '@/hooks/store/useWorkspaceUiStore'
import { PanelLeftClose, PanelLeftOpen } from 'lucide-react'

interface PaletteItem { kind: ChainNodeKind | 'loop-zone'; label: string; group: string }

const ITEMS: PaletteItem[] = [
  { kind: 'seed', label: 'Seed', group: 'Sources' },
  { kind: 'context', label: 'Context', group: 'Sources' },
  { kind: 'agent', label: 'Agent', group: 'Agents' },
  { kind: 'decider', label: 'Decider', group: 'Agents' },
  { kind: 'gate', label: 'Gate', group: 'Control flow' },
  { kind: 'branch', label: 'Branch', group: 'Control flow' },
  { kind: 'loop-zone', label: 'Loop zone', group: 'Loop' },
  { kind: 'subchain', label: 'Subchain', group: 'Composite' },
]
const GROUPS = ['Sources', 'Agents', 'Control flow', 'Loop', 'Composite']

export default function NodePalette({ onAdd, onAddLoopZone }: {
  onAdd: (kind: ChainNodeKind) => void
  onAddLoopZone: () => void
}) {
  const [query, setQuery] = useState('')
  const fuse = useMemo(() => new Fuse(ITEMS, { keys: ['label', 'group'], threshold: 0.4 }), [])
  const visible = query.trim() ? fuse.search(query).map(r => r.item) : ITEMS

  const click = (item: PaletteItem) => {
    if (item.kind === 'loop-zone') onAddLoopZone()
    else onAdd(item.kind)
  }

  const collapsed = useWorkspaceUiStore(s => s.paletteCollapsed)
  if (collapsed) {
    return (
      <div className="w-9 shrink-0 border-r border-zinc-100 bg-white flex flex-col items-center py-2">
        <button onClick={() => useWorkspaceUiStore.getState().togglePalette()} className="text-zinc-400 hover:text-zinc-700" aria-label="Open palette">
          <PanelLeftOpen size={16} />
        </button>
      </div>
    )
  }

  return (
    <div className="w-44 shrink-0 border-r border-zinc-100 bg-white p-3 overflow-auto">
      <div className="flex justify-end mb-1">
        <button onClick={() => useWorkspaceUiStore.getState().togglePalette()} className="text-zinc-300 hover:text-zinc-600" aria-label="Collapse palette">
          <PanelLeftClose size={14} />
        </button>
      </div>
      <input
        value={query}
        onChange={e => setQuery(e.target.value)}
        placeholder="Search nodes…"
        className="w-full text-xs border border-zinc-200 rounded px-2 py-1 mb-3"
      />
      {GROUPS.map(group => {
        const items = visible.filter(i => i.group === group)
        if (items.length === 0) return null
        return (
          <div key={group} className="mb-3">
            <div className="text-[9px] font-bold text-zinc-400 uppercase tracking-widest mb-1">{group}</div>
            <div className="flex flex-col gap-1">
              {items.map(item => (
                <button
                  key={item.kind}
                  onClick={() => click(item)}
                  className="text-left text-xs px-2 py-1 rounded border border-zinc-200 hover:bg-zinc-50 hover:border-zinc-300 transition-colors"
                >
                  {item.label}
                </button>
              ))}
            </div>
          </div>
        )
      })}
    </div>
  )
}
