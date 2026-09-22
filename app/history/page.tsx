'use client'

import { useState, useEffect, useMemo } from 'react'
import { RunMeta } from '@/lib/types'
import { changedSince, findPreviousRun, type ChangedSinceResult } from '@/lib/changedSince'
import RunCard from '@/components/RunCard'
import { useWorkspaceStore } from '@/hooks/store/useWorkspaceStore'
import { X } from 'lucide-react'

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

  return (
    <div className="max-w-4xl mx-auto px-6 py-12 flex flex-col gap-8">
      <div className="flex flex-col gap-6 sm:flex-row sm:items-center sm:justify-between">
        <h1 className="text-3xl font-bold text-zinc-900 tracking-tight">Run History</h1>
        
        <div className="flex flex-wrap gap-3">
          <select 
            className="px-3 py-2 border border-zinc-200 rounded-lg bg-white text-xs font-medium text-zinc-600 focus:outline-none focus:ring-2 focus:ring-zinc-100"
            value={filterChain}
            onChange={(e) => setFilterChain(e.target.value)}
          >
            <option value="">All Chains</option>
            {chains.map(c => <option key={c.slug} value={c.name}>{c.name}</option>)}
          </select>
          
          <select 
            className="px-3 py-2 border border-zinc-200 rounded-lg bg-white text-xs font-medium text-zinc-600 focus:outline-none focus:ring-2 focus:ring-zinc-100"
            value={filterStatus}
            onChange={(e) => setFilterStatus(e.target.value)}
          >
            <option value="">All Statuses</option>
            <option value="running">Running</option>
            <option value="complete">Complete</option>
            <option value="error">Error</option>
          </select>
          
          <div className="relative">
            <input 
              type="text"
              placeholder="Search prompt..."
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
        <div className="grid grid-cols-1 gap-4">
          {runs.map(run => (
            <RunCard key={run.runId} run={run} changedSince={previousRunsMap.get(run.runId)} />
          ))}
        </div>
      )}
    </div>
  )
}
