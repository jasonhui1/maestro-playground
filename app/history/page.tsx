'use client'

import { useState, useEffect } from 'react'
import { RunMeta } from '@/lib/types'
import RunCard from '@/components/RunCard'

export default function HistoryPage() {
  const [runs, setRuns] = useState<RunMeta[]>([])
  const [loading, setLoading] = useState(true)
  const [chains, setChains] = useState<string[]>([])
  
  const [filterChain, setFilterChain] = useState('')
  const [filterStatus, setFilterStatus] = useState('')
  const [filterKeyword, setFilterKeyword] = useState('')

  useEffect(() => {
    fetch('/api/workspace')
      .then(res => res.json())
      .then(data => {
        setChains(data.chains.map((c: { name: string }) => c.name))
      })
  }, [])

  useEffect(() => {
    const params = new URLSearchParams()
    if (filterChain) params.set('chainName', filterChain)
    if (filterStatus) params.set('status', filterStatus)
    if (filterKeyword) params.set('keyword', filterKeyword)

    const fetchRuns = async () => {
      setLoading(true)
      try {
        const res = await fetch(`/api/runs?${params.toString()}`)
        const data = await res.json()
        setRuns(data)
      } finally {
        setLoading(false)
      }
    }

    fetchRuns()
  }, [filterChain, filterStatus, filterKeyword])

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
            {chains.map(c => <option key={c} value={c}>{c}</option>)}
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
                <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>
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
            <RunCard key={run.runId} run={run} />
          ))}
        </div>
      )}
    </div>
  )
}
