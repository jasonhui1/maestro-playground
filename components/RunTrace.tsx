'use client'
import { useState } from 'react'
import { CheckCircle2, AlertCircle, AlertTriangle } from 'lucide-react'
import type { NodeRunState, RunStateMap } from '@/lib/runState'
import { NodeRunPanel } from '@/components/trace/NodeRunPanel'

function StatusIcon({ status }: { status: NodeRunState['status'] }) {
  if (status === 'success') return <CheckCircle2 size={14} className="text-green-500 shrink-0" />
  if (status === 'error') return <AlertCircle size={14} className="text-red-500 shrink-0" />
  if (status === 'running') return <div className="w-3.5 h-3.5 shrink-0 border-2 border-zinc-200 border-t-zinc-500 rounded-full animate-spin" />
  if (status === 'skipped') return <div className="w-3.5 h-3.5 shrink-0 rounded-full border-2 border-dashed border-zinc-300" />
  return <div className="w-3.5 h-3.5 shrink-0 rounded-full bg-zinc-200" />
}

export function RunTrace({ order, states }: { order: string[]; states: RunStateMap }) {
  const [selected, setSelected] = useState<string | null>(null)
  const active = selected && states[selected] ? selected : order[order.length - 1] ?? null

  if (order.length === 0) {
    return <div className="text-sm text-zinc-300 italic py-8 text-center">Waiting for instance to start...</div>
  }

  return (
    <div className="grid grid-cols-1 md:grid-cols-[minmax(9rem,13rem)_1fr] rounded-xl border border-zinc-200 bg-white overflow-hidden">
      <div className="md:border-r border-b md:border-b-0 border-zinc-200 bg-zinc-50/60 flex md:flex-col overflow-x-auto">
        {order.map((id, i) => {
          const s = states[id]
          if (!s) return null
          return (
            <button
              key={id}
              onClick={() => setSelected(id)}
              className={`flex items-center gap-2 px-3 py-2.5 text-left md:border-b border-zinc-100 shrink-0 transition-colors ${
                active === id ? 'bg-white' : 'hover:bg-white/60'
              }`}
            >
              <span className="text-[10px] font-mono text-zinc-300 w-4 shrink-0">{i + 1}</span>
              <StatusIcon status={s.status} />
              <span className="flex-1 text-xs font-medium text-zinc-700 truncate">{s.agentName ?? id}</span>
              {s.warnings.length > 0 && (
                <AlertTriangle size={11} className="text-amber-500 shrink-0" aria-label="convention warning" />
              )}
              {s.rounds.length > 1 && (
                <span className="text-[9px] font-bold text-amber-600 shrink-0">×{s.rounds.length}</span>
              )}
            </button>
          )
        })}
      </div>

      {active && states[active]
        ? <NodeRunPanel key={active} nodeId={active} state={states[active]} />
        : <div className="p-6 text-sm text-zinc-300 italic">Select a step.</div>}
    </div>
  )
}
