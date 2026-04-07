'use client'

import { useState, useEffect, use } from 'react'
import { RunMeta } from '@/lib/types'
import TokenCostBar from '@/components/TokenCostBar'
import DiffViewer from '@/components/DiffViewer'
import Link from 'next/link'
import { useRouter } from 'next/navigation'

export default function RunDetailPage({ params }: { params: Promise<{ runId: string }> }) {
  const { runId } = use(params)
  const router = useRouter()
  const [run, setRun] = useState<RunMeta | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [isBranching, setIsBranching] = useState(false)
  
  const [compareMode, setCompareMode] = useState(false)
  const [leftIdx, setLeftIdx] = useState<number>(0)
  const [rightIdx, setRightIdx] = useState<number>(1)

  useEffect(() => {
    fetch(`/api/runs/${runId}`)
      .then(res => {
        if (!res.ok) throw new Error('Run not found')
        return res.json()
      })
      .then(data => {
        setRun(data)
        setLoading(false)
        if (data.agentOutputs.length > 1) {
          setRightIdx(1)
        } else {
          setRightIdx(0)
        }
      })
      .catch(err => {
        setError(err.message)
        setLoading(false)
      })
  }, [runId])

  async function handleBranch(fromStep: number) {
    if (!run) return
    setIsBranching(true)
    const seedPrompt = run.seedPrompt
    const branchOutputs = run.agentOutputs.slice(0, fromStep)
    const res = await fetch('/api/run', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chainName: run.chainName,
        seedPrompt,
        branchedFromRunId: run.runId,
        branchedFromStep: fromStep,
        branchOutputs,
      }),
    })
    
    const reader = res.body!.getReader()
    const decoder = new TextDecoder()
    let newRunId = ''
    let buffer = ''

    while (true) {
      const { done, value } = await reader.read()
      
      const chunk = done 
        ? decoder.decode() 
        : decoder.decode(value, { stream: true })
      
      buffer += chunk
      const lines = buffer.split('\n')
      buffer = lines.pop() || ''

      for (const line of lines) {
        if (!line.startsWith('data: ')) continue
        
        try {
          const event = JSON.parse(line.slice(6))
          if (event.type === 'run_complete') newRunId = event.runId
        } catch (e) {
          console.error('Error parsing SSE event:', e)
        }
      }
      
      if (done) break
    }
    if (newRunId) router.push(`/history/${newRunId}`)
    setIsBranching(false)
  }

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center py-24 text-zinc-400 gap-3">
        <div className="w-6 h-6 border-2 border-zinc-200 border-t-zinc-800 rounded-full animate-spin" />
        <span className="text-xs font-medium uppercase tracking-widest">Loading run details</span>
      </div>
    )
  }

  if (error || !run) {
    return (
      <div className="max-w-4xl mx-auto px-6 py-24 text-center">
        <h1 className="text-2xl font-bold text-zinc-900 mb-4">Run Not Found</h1>
        <p className="text-zinc-500 mb-8">The run ID you&apos;re looking for doesn&apos;t exist or has been deleted.</p>
        <Link href="/history" className="text-sm font-bold underline underline-offset-4">Back to History</Link>
      </div>
    )
  }

  return (
    <div className="max-w-6xl mx-auto px-6 py-12 flex flex-col gap-12">
      {/* Header */}
      <div className="flex flex-col gap-6 md:flex-row md:items-end md:justify-between">
        <div className="flex flex-col gap-2">
          <Link href="/history" className="text-xs font-bold text-zinc-400 hover:text-zinc-900 flex items-center gap-1 transition-colors">
            <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><path d="m15 18-6-6 6-6"/></svg>
            BACK TO HISTORY
          </Link>
          <h1 className="text-4xl font-bold text-zinc-900 tracking-tight">{run.chainName}</h1>
          <div className="flex items-center gap-3 text-xs font-medium text-zinc-500">
            <span className="px-2 py-0.5 rounded-md bg-zinc-100 text-zinc-900 font-bold uppercase tracking-wider">{run.status}</span>
            <span>•</span>
            <span>{new Date(run.startedAt).toLocaleString()}</span>
            <span>•</span>
            <span className="font-mono">{run.runId}</span>
          </div>
        </div>

        <div className="flex gap-3">
          <a 
            href={`/api/runs/${runId}/export?format=markdown`}
            className="px-4 py-2 rounded-xl text-xs font-bold transition-all border bg-white border-zinc-200 text-zinc-600 hover:border-zinc-900 hover:text-zinc-900 flex items-center gap-2"
          >
            <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" x2="12" y1="15" y2="3"/></svg>
            EXPORT .MD
          </a>
          <a 
            href={`/api/runs/${runId}/export?format=json`}
            className="px-4 py-2 rounded-xl text-xs font-bold transition-all border bg-white border-zinc-200 text-zinc-600 hover:border-zinc-900 hover:text-zinc-900 flex items-center gap-2"
          >
            <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" x2="12" y1="15" y2="3"/></svg>
            EXPORT .JSON
          </a>
          <button 
            onClick={() => setCompareMode(!compareMode)}
            className={`px-4 py-2 rounded-xl text-xs font-bold transition-all border ${
              compareMode 
                ? 'bg-zinc-900 border-zinc-900 text-white shadow-lg shadow-zinc-200' 
                : 'bg-white border-zinc-200 text-zinc-600 hover:border-zinc-900 hover:text-zinc-900'
            }`}
          >
            {compareMode ? 'EXIT COMPARE' : 'COMPARE OUTPUTS'}
          </button>
        </div>
      </div>

      {/* Seed Prompt */}
      <div className="bg-zinc-50 rounded-2xl p-8 border border-zinc-100">
        <h2 className="text-[10px] font-bold uppercase tracking-[0.2em] text-zinc-400 mb-4">Seed Prompt</h2>
        <p className="text-lg text-zinc-800 leading-relaxed font-medium italic">&quot;{run.seedPrompt}&quot;</p>
      </div>

      {compareMode ? (
        <div className="flex flex-col gap-8">
          <div className="flex flex-wrap gap-6 items-center justify-center bg-zinc-50 p-4 rounded-2xl border border-zinc-100">
            <div className="flex items-center gap-3">
              <span className="text-[10px] font-bold text-zinc-400 uppercase tracking-wider">Left:</span>
              <select 
                className="bg-white border border-zinc-200 rounded-lg px-3 py-1.5 text-xs font-bold text-zinc-900 focus:outline-none focus:ring-2 focus:ring-zinc-100"
                value={leftIdx}
                onChange={(e) => setLeftIdx(parseInt(e.target.value))}
              >
                {run.agentOutputs.map((out, i) => (
                  <option key={i} value={i}>{i+1}. {out.agentName}</option>
                ))}
              </select>
            </div>
            <div className="w-px h-4 bg-zinc-200 hidden md:block" />
            <div className="flex items-center gap-3">
              <span className="text-[10px] font-bold text-zinc-400 uppercase tracking-wider">Right:</span>
              <select 
                className="bg-white border border-zinc-200 rounded-lg px-3 py-1.5 text-xs font-bold text-zinc-900 focus:outline-none focus:ring-2 focus:ring-zinc-100"
                value={rightIdx}
                onChange={(e) => setRightIdx(parseInt(e.target.value))}
              >
                {run.agentOutputs.map((out, i) => (
                  <option key={i} value={i}>{i+1}. {out.agentName}</option>
                ))}
              </select>
            </div>
          </div>

          <DiffViewer 
            leftTitle={`${run.agentOutputs[leftIdx]?.agentName} (${run.agentOutputs[leftIdx]?.model})`}
            leftContent={run.agentOutputs[leftIdx]?.output || ''}
            rightTitle={`${run.agentOutputs[rightIdx]?.agentName} (${run.agentOutputs[rightIdx]?.model})`}
            rightContent={run.agentOutputs[rightIdx]?.output || ''}
          />
        </div>
      ) : (
        <div className="flex flex-col gap-6">
          <h2 className="text-[10px] font-bold uppercase tracking-[0.2em] text-zinc-400">Agent Execution Chain</h2>
          <div className="flex flex-col gap-4">
            {run.agentOutputs.map((output, idx) => (
              <div key={idx} className="group flex flex-col border border-zinc-200 rounded-2xl overflow-hidden bg-white hover:border-zinc-300 transition-all shadow-sm hover:shadow-md">
                <div className="bg-zinc-50 px-6 py-4 border-b border-zinc-200 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                  <div className="flex items-center gap-4">
                    <div className="w-8 h-8 rounded-full bg-zinc-900 text-white flex items-center justify-center text-xs font-bold">
                      {idx + 1}
                    </div>
                    <div className="flex flex-col">
                      <span className="text-sm font-bold text-zinc-900">{output.agentName}</span>
                      <span className="text-[10px] font-medium text-zinc-400 uppercase tracking-wider">{output.model} • {output.latencyMs}ms</span>
                    </div>
                  </div>
                  <div className="flex flex-col sm:flex-row sm:items-center gap-4 sm:gap-8">
                    <button
                      onClick={() => handleBranch(idx)}
                      disabled={isBranching}
                      className="text-[10px] font-bold text-zinc-400 hover:text-zinc-900 border border-zinc-200 rounded-md px-3 py-1.5 transition-all hover:bg-zinc-50 disabled:opacity-50 whitespace-nowrap"
                    >
                      {isBranching ? 'BRANCHING...' : 'BRANCH FROM HERE'}
                    </button>
                    <div className="w-full sm:w-48">
                      <TokenCostBar 
                        tokensIn={output.tokensIn} 
                        tokensOut={output.tokensOut} 
                        costUsd={output.costUsd} 
                      />
                    </div>
                  </div>
                </div>
                <div className="p-8">
                  <div className="prose prose-zinc max-w-none">
                    <pre className="text-xs font-mono leading-relaxed whitespace-pre-wrap text-zinc-800 bg-zinc-50 p-6 rounded-xl border border-zinc-100">
                      {output.output}
                    </pre>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
