'use client'
import { useState, useEffect } from 'react'
import { ChainSelector } from '@/components/ChainSelector'
import { TemplateSelector } from '@/components/TemplateSelector'
import { RunTrace } from '@/components/RunTrace'
import { ChainDef, TemplateDef } from '@/lib/types'
import { streamRun } from '@/lib/runStream'
import { InstanceRunMap, InstanceOrder, applyInstanceEvent, applyInstanceOrder, orderFor } from '@/lib/runModel'

export default function RunPage() {
  const [chains, setChains] = useState<ChainDef[]>([])
  const [templates, setTemplates] = useState<TemplateDef[]>([])
  const [selectedChain, setSelectedChain] = useState('')
  const [seedPrompt, setSeedPrompt] = useState('')
  const [parallelCount, setParallelCount] = useState(1)
  const [runState, setRunState] = useState<InstanceRunMap>({})
  const [runOrder, setRunOrder] = useState<InstanceOrder>({})
  const [isRunning, setIsRunning] = useState(false)
  const [completedRuns, setCompletedRuns] = useState<string[]>([])
  const [runError, setRunError] = useState<string | null>(null)

  useEffect(() => {
    fetch('/api/workspace')
      .then(r => r.json())
      .then(data => {
        setChains(data.chains)
        setTemplates(data.templates)
        if (data.chains.length > 0) setSelectedChain(data.chains[0].name)
      })
  }, [])

  function handleTemplateSelect(template: TemplateDef) {
    setSeedPrompt(template.seedPrompt)
    if (template.chain) {
      setSelectedChain(template.chain)
    }
  }

  async function runSingleInstance(runIndex: number) {
    const res = await fetch('/api/run', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chainName: selectedChain, seedPrompt }),
    })

    if (!res.ok) {
      const body = await res.json().catch(() => ({}))
      setRunError((body.errors as string[] | undefined)?.join('; ') ?? body.error ?? `Run failed (${res.status})`)
      return
    }

    const reader = res.body?.getReader()
    if (!reader) return

    await streamRun(reader, e => {
      if (e.type === 'error') { setRunError(e.error); return }
      if (e.type === 'run_complete') { setCompletedRuns(prev => [...prev, e.runId]); return }
      setRunState(prev => applyInstanceEvent(prev, runIndex, e))
      setRunOrder(prev => applyInstanceOrder(prev, runIndex, e))
    })
  }

  async function handleRun() {
    setRunState({})
    setRunOrder({})
    setCompletedRuns([])
    setRunError(null)
    setIsRunning(true)

    try {
      await Promise.all(
        Array.from({ length: parallelCount }).map((_, i) => runSingleInstance(i))
      )
    } catch (err) {
      console.error('Parallel run failed:', err)
    } finally {
      setIsRunning(false)
    }
  }

  return (
    <div className="max-w-6xl mx-auto px-6 py-10 flex flex-col gap-6">
      <h1 className="text-2xl font-semibold text-zinc-800">Run a chain</h1>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
        <div className="flex flex-col gap-6">
          <TemplateSelector
            templates={templates}
            onSelect={handleTemplateSelect}
          />

          <ChainSelector
            chains={chains}
            selected={selectedChain}
            onChange={setSelectedChain}
          />

          <div className="flex flex-col gap-1">
            <label className="text-xs font-medium text-zinc-500 uppercase tracking-wide">
              Seed prompt
            </label>
            <textarea
              rows={3}
              value={seedPrompt}
              onChange={e => setSeedPrompt(e.target.value)}
              placeholder="A grim empire at the edge of a magical dead zone..."
              className="rounded-lg border border-zinc-200 px-3 py-2 text-sm resize-none focus:ring-2 focus:ring-zinc-900 outline-none transition-all"
            />
          </div>

          <div className="flex items-center gap-4">
            <div className="flex flex-col gap-1">
              <label className="text-xs font-medium text-zinc-500 uppercase tracking-wide">
                Parallel Runs
              </label>
              <input
                type="number"
                min={1}
                max={10}
                value={parallelCount}
                onChange={e => setParallelCount(parseInt(e.target.value) || 1)}
                className="w-24 rounded-lg border border-zinc-200 px-3 py-2 text-sm focus:ring-2 focus:ring-zinc-900 outline-none transition-all"
              />
            </div>

            <button
              onClick={handleRun}
              disabled={isRunning || !seedPrompt || !selectedChain}
              className="mt-5 self-start rounded-lg bg-zinc-900 text-white px-8 py-2 text-sm font-medium
                disabled:opacity-40 hover:bg-zinc-700 transition-all active:scale-95 shadow-sm"
            >
              {isRunning ? 'Running...' : `Run ${parallelCount > 1 ? parallelCount + ' instances' : 'chain'}`}
            </button>
          </div>
        </div>

        <div className="bg-zinc-50 rounded-2xl p-6 border border-zinc-100">
          <h2 className="text-sm font-bold text-zinc-400 uppercase tracking-widest mb-4">Run Status</h2>
          <div className="flex flex-col gap-2">
            {isRunning && <div className="text-sm text-blue-600 animate-pulse font-medium">Executing parallel runs...</div>}
            {runError && (
              <div className="text-xs text-red-600 bg-red-50 border border-red-100 rounded px-2 py-1.5">{runError}</div>
            )}
            {completedRuns.length > 0 && (
              <div className="text-xs text-zinc-500 flex flex-col gap-1">
                <span className="font-bold text-zinc-700">Completed Runs:</span>
                {completedRuns.map(id => (
                  <code key={id} className="bg-white px-2 py-1 rounded border border-zinc-200">{id}</code>
                ))}
              </div>
            )}
            {!isRunning && completedRuns.length === 0 && (
              <div className="text-sm text-zinc-400 italic">No active runs. Configure and click Run.</div>
            )}
          </div>
        </div>
      </div>

      <div className={`grid gap-6 mt-8 ${parallelCount > 1 ? 'grid-cols-1 lg:grid-cols-2' : 'grid-cols-1'}`}>
        {Array.from({ length: parallelCount }).map((_, runIndex) => (
          <div key={runIndex} className="flex flex-col gap-4 p-6 rounded-2xl bg-zinc-50/50 border border-zinc-200 shadow-sm">
            <div className="flex items-center justify-between border-b border-zinc-200 pb-3 mb-1">
              <h3 className="text-xs font-bold text-zinc-500 uppercase tracking-widest">Instance #{runIndex + 1}</h3>
              {completedRuns[runIndex] && (
                <span className="text-[10px] bg-green-100 text-green-700 px-2 py-0.5 rounded-full font-bold uppercase tracking-wider">Complete</span>
              )}
            </div>
            <RunTrace order={orderFor(runOrder, runIndex)} states={runState[runIndex] ?? {}} />
          </div>
        ))}
      </div>
    </div>
  )
}
