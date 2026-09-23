'use client'

import { useState, useEffect, useMemo } from 'react'
import { RunMeta } from '@/lib/types'
import { changedSince, findPreviousRun, type ChangedSinceResult } from '@/lib/changedSince'
import RunCard from '@/components/RunCard'
import { useWorkspaceStore } from '@/hooks/store/useWorkspaceStore'
import { X } from 'lucide-react'
import { buildVarianceGroup } from '@/lib/variance'
import { VarianceRunCard } from '@/components/VarianceRunCard'

const STATUS_FILTERS = [
  { id: '', label: 'All' },
  { id: 'complete', label: 'Completed' },
  { id: 'waiting', label: 'Holds / Waiting' },
  { id: 'error', label: 'Failed' },
] as const

export default function HistoryPage() {
  const [allRuns, setAllRuns] = useState<RunMeta[]>([])
  const [loading, setLoading] = useState(true)

  const [filterChain, setFilterChain] = useState('')
  const [filterStatus, setFilterStatus] = useState('')
  const [filterKeyword, setFilterKeyword] = useState('')

  const chains = useWorkspaceStore(s => s.files.chains)

  useEffect(() => { useWorkspaceStore.getState().load() }, [])

  useEffect(() => {
    fetch('/api/runs')
      .then(res => res.json())
      .then(data => {
        if (Array.isArray(data)) setAllRuns(data)
      })
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [])

  const runs = useMemo(() => {
    let list = allRuns
    if (filterChain) {
      list = list.filter(r => r.chainName === filterChain)
    }
    if (filterStatus) {
      list = list.filter(r => r.status === filterStatus)
    }
    if (filterKeyword) {
      const kw = filterKeyword.toLowerCase()
      list = list.filter(r =>
        r.seedPrompt.toLowerCase().includes(kw) ||
        r.runId.toLowerCase().includes(kw)
      )
    }
    return list
  }, [allRuns, filterChain, filterStatus, filterKeyword])

  const previousRunsMap = useMemo(() => {
    const map = new Map<string, ChangedSinceResult>()
    for (const r of allRuns) {
      const pred = findPreviousRun(allRuns, r)
      map.set(r.runId, changedSince(pred, r))
    }
    return map
  }, [allRuns])

  const historyItems = useMemo<Array<
    | { kind: 'run'; run: RunMeta }
    | { kind: 'variance'; group: ReturnType<typeof buildVarianceGroup> }
  >>(() => {
    const seenGroups = new Set<string>()
    const runsByGroup = new Map<string, RunMeta[]>()
    for (const candidate of allRuns) {
      const groupId = candidate.variance?.groupId
      if (!groupId) continue
      const members = runsByGroup.get(groupId) ?? []
      members.push(candidate)
      runsByGroup.set(groupId, members)
    }
    const items: Array<
      | { kind: 'run'; run: RunMeta }
      | { kind: 'variance'; group: ReturnType<typeof buildVarianceGroup> }
    > = []
    for (const run of runs) {
      const groupId = run.variance?.groupId
      if (!groupId) {
        items.push({ kind: 'run', run })
        continue
      }
      if (seenGroups.has(groupId)) continue
      seenGroups.add(groupId)
      items.push({ kind: 'variance', group: buildVarianceGroup(runsByGroup.get(groupId) ?? []) })
    }
    return items
  }, [runs, allRuns])

  return (
    <div className="max-w-6xl mx-auto px-6 py-12 flex flex-col gap-6">
      <div className="flex flex-col gap-4">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <h1 className="text-3xl font-bold text-zinc-900 tracking-tight">Run History</h1>

          <div className="flex flex-wrap items-center gap-3">
            <select
              className="px-3 py-2 border border-zinc-200 rounded-lg bg-white text-xs font-medium text-zinc-600 focus:outline-none focus:ring-2 focus:ring-zinc-100"
              value={filterChain}
              onChange={(e) => setFilterChain(e.target.value)}
            >
              <option value="">All Chains</option>
              {chains.map(c => <option key={c.slug} value={c.name}>{c.name}</option>)}
            </select>

            <div className="relative">
              <input
                type="text"
                placeholder="Search prompt or run ID..."
                className="pl-3 pr-10 py-2 border border-zinc-200 rounded-lg bg-white text-xs font-medium text-zinc-600 w-48 sm:w-64 focus:outline-none focus:ring-2 focus:ring-zinc-100"
                value={filterKeyword}
                onChange={(e) => setFilterKeyword(e.target.value)}
              />
              {filterKeyword && (
                <button
                  onClick={() => setFilterKeyword('')}
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-zinc-400 hover:text-zinc-600"
                >
                  <X size={14} />
                </button>
              )}
            </div>
          </div>
        </div>

        {/* Quick status filter chips (#142) */}
        <div className="flex items-center gap-2">
          {STATUS_FILTERS.map(pill => (
            <button
              key={pill.id}
              type="button"
              onClick={() => setFilterStatus(pill.id)}
              className={`px-3 py-1.5 rounded-full text-xs font-medium transition-colors cursor-pointer ${
                filterStatus === pill.id
                  ? 'bg-zinc-900 text-white shadow-sm'
                  : 'bg-white text-zinc-600 border border-zinc-200 hover:bg-zinc-50 hover:text-zinc-900'
              }`}
            >
              {pill.label}
            </button>
          ))}
        </div>
      </div>

      {loading ? (
        <div className="flex flex-col items-center justify-center py-24 text-zinc-400 gap-3">
          <div className="w-6 h-6 border-2 border-zinc-200 border-t-zinc-800 rounded-full animate-spin" />
          <span className="text-xs font-medium uppercase tracking-widest">Loading history</span>
        </div>
      ) : runs.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-24 border-2 border-dashed border-zinc-100 rounded-2xl bg-zinc-50/50">
          <p className="text-sm text-zinc-500 font-medium">No runs found matching your filters.</p>
          <button
            onClick={() => { setFilterChain(''); setFilterStatus(''); setFilterKeyword(''); }}
            className="mt-4 text-xs text-zinc-900 font-bold underline underline-offset-4 hover:text-zinc-600"
          >
            Clear all filters
          </button>
        </div>
      ) : (
        /* High-density executive run ledger table (#142) */
        <div className="overflow-x-auto rounded-xl border border-zinc-200 bg-white shadow-sm">
          <table className="w-full text-left text-xs border-collapse">
            <thead>
              <tr className="border-b border-zinc-200 bg-zinc-50/75 text-[11px] font-semibold uppercase tracking-wider text-zinc-500">
                <th className="py-3 px-4 w-28">Status</th>
                <th className="py-3 px-4 w-52">Chain</th>
                <th className="py-3 px-4 min-w-[200px]">Prompt</th>
                <th className="py-3 px-4 w-32">Drift</th>
                <th className="py-3 px-4 w-20 text-right">Steps</th>
                <th className="py-3 px-4 w-28 text-right">Tokens</th>
                <th className="py-3 px-4 w-28 text-right">Cost</th>
                <th className="py-3 px-4 w-44 text-right">Time</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-100">
              {historyItems.map(item =>
                item.kind === 'variance' ? (
                  <VarianceRunCard key={item.group.groupId} group={item.group} />
                ) : (
                  <RunCard
                    key={item.run.runId}
                    run={item.run}
                    changedSince={previousRunsMap.get(item.run.runId)}
                  />
                )
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
