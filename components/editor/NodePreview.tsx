'use client'
import React from 'react'
import type { NodeRunState } from '@/lib/runState'

export default function NodePreview({ run, nodeId }: { run?: NodeRunState; nodeId: string | null }) {
  if (!nodeId) return <div className="px-4 py-3 text-[11px] text-zinc-400 italic">Select a node to preview its output.</div>
  if (!run) return <div className="px-4 py-3 text-[11px] text-zinc-400 italic">No run output for “{nodeId}” yet.</div>
  return (
    <div className="px-4 py-3 overflow-auto">
      <div className="text-[10px] font-bold text-zinc-400 uppercase tracking-widest mb-1">{nodeId} · {run.status}</div>
      {run.rounds.length > 1 ? (
        run.rounds.map(r => (
          <div key={r.round} className="mb-2">
            <div className="text-[9px] font-bold text-zinc-400">round {r.round}</div>
            <pre className="text-[11px] whitespace-pre-wrap text-zinc-700">{r.output}</pre>
          </div>
        ))
      ) : (
        <pre className="text-[11px] whitespace-pre-wrap text-zinc-700">{run.output}</pre>
      )}
      {run.thought && <pre className="mt-2 text-[10px] whitespace-pre-wrap text-zinc-400 border-t border-zinc-100 pt-2">{run.thought}</pre>}
    </div>
  )
}
