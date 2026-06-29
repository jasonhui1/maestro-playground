'use client'
import React from 'react'
import { useRunStore } from '@/hooks/store/useRunStore'
import { useSelectionStore } from '@/hooks/store/useSelectionStore'
import type { NodeRunState } from '@/lib/runState'

function NodeOutput({ nodeId, run }: { nodeId: string; run?: NodeRunState }) {
  if (!run) return <div className="px-4 py-2 text-[11px] text-zinc-400 italic">No output for “{nodeId}” yet.</div>
  if (run.status === 'skipped') return <div className="px-4 py-2 text-[11px] text-zinc-400 italic">{nodeId} — skipped (no output)</div>
  return (
    <div className="px-4 py-2">
      <div className="text-[10px] font-bold text-zinc-400 uppercase tracking-widest mb-1">{nodeId} · {run.status}</div>
      {run.rounds.length > 1
        ? run.rounds.map(r => (
            <div key={r.round} className="mb-2">
              <div className="text-[9px] font-bold text-zinc-400">round {r.round}</div>
              <pre className="text-[11px] whitespace-pre-wrap text-zinc-700">{r.output}</pre>
            </div>
          ))
        : <pre className="text-[11px] whitespace-pre-wrap text-zinc-700">{run.output}</pre>}
      {run.thought && <pre className="mt-2 text-[10px] whitespace-pre-wrap text-zinc-400 border-t border-zinc-100 pt-2">{run.thought}</pre>}
    </div>
  )
}

export default function OutputTab({ fileKey, view }: { fileKey: string; view: 'graph' | 'yaml' | 'agent' }) {
  const file = useRunStore(s => s.byFile[fileKey])
  const selected = useSelectionStore(s => s.byFile[fileKey] ?? null)
  const instance = file?.currentInstance ?? 0
  const map = file?.runState[instance] ?? {}
  const nodeIds = Object.keys(map)

  if (!file || nodeIds.length === 0) {
    return <div className="px-4 py-3 text-[11px] text-zinc-400 italic">No output yet. Click Run to start.</div>
  }
  if (view === 'graph') {
    if (!selected) return <div className="px-4 py-3 text-[11px] text-zinc-400 italic">Select a node to see its output.</div>
    return <NodeOutput nodeId={selected} run={map[selected]} />
  }
  // yaml + agent: stack all nodes in the current instance
  return <div className="divide-y divide-zinc-100">{nodeIds.map(id => <NodeOutput key={id} nodeId={id} run={map[id]} />)}</div>
}
