'use client'
import React from 'react'
import { useRunStore } from '@/hooks/store/useRunStore'
import { useSelectionStore } from '@/hooks/store/useSelectionStore'
import { NodeRunPanel } from '@/components/trace/NodeRunPanel'
import { RunTrace } from '@/components/RunTrace'
import { orderFor } from '@/lib/runModel'

export default function OutputTab({ fileKey, view }: { fileKey: string; view: 'graph' | 'yaml' | 'agent' }) {
  const file = useRunStore(s => s.byFile[fileKey])
  const selected = useSelectionStore(s => s.byFile[fileKey] ?? null)
  const instance = file?.currentInstance ?? 0
  const map = file?.runState[instance] ?? {}
  const order = orderFor(file?.runOrder ?? {}, instance)

  if (!file || order.length === 0) {
    return <div className="px-4 py-3 text-[11px] text-zinc-400 italic">No output yet. Click Run to start.</div>
  }
  // graph view: the canvas is the selector, so the panel goes bare — a rail here would be a second one (#38)
  if (view === 'graph') {
    if (!selected) return <div className="px-4 py-3 text-[11px] text-zinc-400 italic">Select a node to see its output.</div>
    const run = map[selected]
    if (!run) return <div className="px-4 py-3 text-[11px] text-zinc-400 italic">No output for “{selected}” yet.</div>
    return <NodeRunPanel key={selected} nodeId={selected} state={run} />
  }
  return <RunTrace order={order} states={map} />
}
