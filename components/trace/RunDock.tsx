'use client'
import { useState } from 'react'
import type { RunMeta } from '@/lib/types'
import type { RunStateMap } from '@/lib/runState'
import { clampTab, type PanelTab } from '@/lib/tabClamp'
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
  const [leftIdx, setLeftIdx] = useState(0)
  const [rightIdx, setRightIdx] = useState(run.agentOutputs.length > 1 ? 1 : 0)

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
            <OutputPicker label="Left" value={leftIdx} onChange={setLeftIdx} run={run} />
            <OutputPicker label="Right" value={rightIdx} onChange={setRightIdx} run={run} />
          </div>
          <DiffViewer
            leftTitle={`${run.agentOutputs[leftIdx]?.agentName} (${run.agentOutputs[leftIdx]?.model})`}
            leftContent={run.agentOutputs[leftIdx]?.output || ''}
            rightTitle={`${run.agentOutputs[rightIdx]?.agentName} (${run.agentOutputs[rightIdx]?.model})`}
            rightContent={run.agentOutputs[rightIdx]?.output || ''}
          />
        </div>
      )}

      {active === 'versions' && <RunPinnedVersions run={run} />}
    </DockShell>
  )
}

function OutputPicker({ label, value, onChange, run }: {
  label: string; value: number; onChange: (i: number) => void; run: RunMeta
}) {
  return (
    <div className="flex items-center gap-2">
      <span className="text-[10px] font-bold text-zinc-400 uppercase tracking-wider">{label}</span>
      <select
        className="bg-white border border-zinc-200 rounded-lg px-2 py-1 text-xs font-bold text-zinc-900 focus:outline-none focus:ring-2 focus:ring-zinc-100"
        value={value}
        onChange={(e) => onChange(parseInt(e.target.value))}
      >
        {run.agentOutputs.map((out, i) => (
          <option key={i} value={i}>{i + 1}. {out.agentName}</option>
        ))}
      </select>
    </div>
  )
}
