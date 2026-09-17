'use client'
import { useState } from 'react'
import type { RunMeta, AgentOutput } from '@/lib/types'
import type { RunStateMap } from '@/lib/runState'
import { clampTab, type PanelTab } from '@/lib/tabClamp'
import { latestOutputsByNode } from '@/lib/runHistoryState'
import { useWorkspaceUiStore } from '@/hooks/store/useWorkspaceUiStore'
import DockShell from '@/components/workspace/DockShell'
import { RunTrace } from '@/components/RunTrace'
import DiffViewer from '@/components/DiffViewer'
import RunPinnedVersions from '@/components/trace/RunPinnedVersions'

const RUN_TABS: PanelTab[] = ['trace', 'compare', 'versions']

export default function RunDock({ run, order, states, selection, branch }: {
  run: RunMeta
  order: string[]
  states: RunStateMap
  selection: { selected: string | null; onSelect: (id: string) => void }
  branch: { onBranch: (nodeId: string, round: number | null) => void; isBranching: boolean }
}) {
  const active = clampTab(useWorkspaceUiStore(s => s.activeTab), RUN_TABS)
  // Latest write per node (#90) — a rerun's stale duplicate drops out of the picker;
  // comparing a loop node's individual rounds stays the sidebar view's job (ADR-0016 rule 4).
  const outputs = latestOutputsByNode(run.agentOutputs)
  const [leftIdx, setLeftIdx] = useState(0)
  const [rightIdx, setRightIdx] = useState(outputs.length > 1 ? 1 : 0)

  return (
    <DockShell tabs={RUN_TABS.map(id => ({ id, label: id }))} active={active}>
      {active === 'trace' && (
        <div className="p-3">
          <RunTrace order={order} states={states} selection={selection} branch={branch} />
        </div>
      )}

      {active === 'compare' && (
        <div className="p-3 flex flex-col gap-3">
          <div className="flex flex-wrap items-center gap-4">
            <OutputPicker label="Left" value={leftIdx} onChange={setLeftIdx} outputs={outputs} />
            <OutputPicker label="Right" value={rightIdx} onChange={setRightIdx} outputs={outputs} />
          </div>
          <DiffViewer
            leftTitle={`${outputs[leftIdx]?.agentName} (${outputs[leftIdx]?.model})`}
            leftContent={outputs[leftIdx]?.output || ''}
            rightTitle={`${outputs[rightIdx]?.agentName} (${outputs[rightIdx]?.model})`}
            rightContent={outputs[rightIdx]?.output || ''}
          />
        </div>
      )}

      {active === 'versions' && <RunPinnedVersions run={run} />}
    </DockShell>
  )
}

function OutputPicker({ label, value, onChange, outputs }: {
  label: string; value: number; onChange: (i: number) => void; outputs: AgentOutput[]
}) {
  return (
    <div className="flex items-center gap-2">
      <span className="text-[10px] font-bold text-zinc-400 uppercase tracking-wider">{label}</span>
      <select
        className="bg-white border border-zinc-200 rounded-lg px-2 py-1 text-xs font-bold text-zinc-900 focus:outline-none focus:ring-2 focus:ring-zinc-100"
        value={value}
        onChange={(e) => onChange(parseInt(e.target.value))}
      >
        {outputs.map((out, i) => (
          <option key={i} value={i}>{i + 1}. {out.agentName}</option>
        ))}
      </select>
    </div>
  )
}
