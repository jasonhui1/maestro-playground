'use client'
import { useState, useEffect, useMemo } from 'react'
import { ChainDef, AgentOutput } from '@/lib/types'
import { streamRun, runErrorMessage } from '@/lib/runStream'
import { applyRunEvent, RunStateMap } from '@/lib/runState'
import { applyOrder } from '@/lib/runModel'
import { buildLayoutModel } from '@/lib/layoutModel'
import { buildRunFrame, SeedSource } from '@/lib/runFrame'
import { usePanelDeck } from '@/hooks/usePanelDeck'
import { Timeline } from '@/components/result/Timeline'
import { Columns } from '@/components/result/Columns'
import { Sidebar } from '@/components/result/Sidebar'
import { RunFrame } from '@/components/result/RunFrame'
import { RunTrace } from '@/components/RunTrace'

type ContextFile = { slug: string; name: string; rawContent?: string }

export default function ResultPage() {
  const [chains, setChains] = useState<ChainDef[]>([])
  const [contextFiles, setContextFiles] = useState<ContextFile[]>([])
  const [chainSlug, setChainSlug] = useState('')
  const [mode, setMode] = useState<'paste' | 'file'>('paste')
  const [pasted, setPasted] = useState('')
  const [fileSlug, setFileSlug] = useState('')
  const [states, setStates] = useState<RunStateMap>({})
  const [order, setOrder] = useState<string[]>([])
  const [running, setRunning] = useState(false)
  const [runId, setRunId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  // The frame and the layout describe the run that started, not the form as it now
  // stands — the form stays live while a finished result is still on screen (#73).
  const [run, setRun] = useState<{ chain: ChainDef; seed: SeedSource; startedAt: number } | null>(null)
  const [endedAt, setEndedAt] = useState<number | null>(null)
  const [now, setNow] = useState(0)
  const deck = usePanelDeck()

  useEffect(() => {
    if (!running) return
    const id = setInterval(() => setNow(Date.now()), 500)
    return () => clearInterval(id)
  }, [running])

  useEffect(() => {
    fetch('/api/workspace')
      .then(r => r.json())
      .then(data => {
        setChains(data.chains ?? [])
        setContextFiles(data.context ?? [])
      })
      .catch(() => setError('Could not load the workspace'))
  }, [])

  const chain = chains.find(c => c.slug === chainSlug)
  const seedFile = contextFiles.find(f => f.slug === fileSlug)
  const seedText = mode === 'paste' ? pasted : seedFile?.rawContent ?? ''
  const seed: SeedSource = mode === 'paste' ? { kind: 'paste' } : { kind: 'file', name: seedFile?.name ?? 'a file' }

  // The run's completed outputs, keyed the way the layout model reads them. Panels fill
  // in as hops land, so the timeline builds up rather than appearing at the end.
  const outputs = useMemo<AgentOutput[]>(
    () => Object.entries(states).flatMap(([nodeId, s]) => (s.result ? [{ ...s.result, nodeId }] : [])),
    [states],
  )
  const model = useMemo(
    () => (run ? buildLayoutModel(run.chain, outputs) : null),
    [run, outputs],
  )
  const frame = useMemo(
    () => (run ? buildRunFrame({ ...run, states, endedAt: endedAt ?? undefined, now }) : null),
    [run, states, endedAt, now],
  )

  async function handleRun() {
    if (!chain) return
    setStates({})
    setOrder([])
    setRunId(null)
    setError(null)
    deck.reset()
    setRun({ chain, seed, startedAt: Date.now() })
    setEndedAt(null)
    setNow(Date.now())
    setRunning(true)
    try {
      const res = await fetch('/api/run', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chainName: chain.name, seedPrompt: seedText }),
      })
      if (!res.ok) { setError(await runErrorMessage(res)); return }
      const reader = res.body?.getReader()
      if (!reader) return
      await streamRun(reader, e => {
        if (e.type === 'error') { setError(e.error); return }
        if (e.type === 'run_complete') { setRunId(e.runId); return }
        setStates(prev => applyRunEvent(prev, e))
        setOrder(prev => applyOrder(prev, e))
      })
    } finally {
      setRunning(false)
      setEndedAt(Date.now())
    }
  }

  return (
    <div className="max-w-6xl mx-auto px-6 py-10 flex flex-col gap-6">
      <h1 className="text-2xl font-semibold text-zinc-800">Result view</h1>

      <div className="flex flex-col gap-4 rounded-2xl border border-zinc-200 p-6">
        <div className="flex items-center gap-4">
          <span className="text-xs font-medium text-zinc-500 uppercase tracking-wide">Input</span>
          {(['paste', 'file'] as const).map(m => (
            <label key={m} className="flex items-center gap-1.5 text-sm text-zinc-700 cursor-pointer">
              <input type="radio" checked={mode === m} onChange={() => setMode(m)} className="accent-zinc-900" />
              {m === 'paste' ? 'Paste text' : 'Pick a file'}
            </label>
          ))}
        </div>

        {mode === 'paste' ? (
          <textarea
            rows={6}
            value={pasted}
            onChange={e => setPasted(e.target.value)}
            placeholder="Paste the text you want to put through the chain..."
            className="rounded-lg border border-zinc-200 px-3 py-2 text-sm resize-y focus:ring-2 focus:ring-zinc-900 outline-none"
          />
        ) : (
          <select
            value={fileSlug}
            onChange={e => setFileSlug(e.target.value)}
            className="rounded-lg border border-zinc-200 px-3 py-2 text-sm focus:ring-2 focus:ring-zinc-900 outline-none"
          >
            <option value="">Choose a context file…</option>
            {contextFiles.map(f => <option key={f.slug} value={f.slug}>{f.name}</option>)}
          </select>
        )}

        <div className="flex flex-col gap-1">
          <span className="text-xs font-medium text-zinc-500 uppercase tracking-wide">Chain</span>
          <div className="flex flex-col gap-1">
            {chains.map(c => (
              <label key={c.slug} className="flex items-start gap-2 text-sm text-zinc-700 cursor-pointer">
                <input
                  type="radio"
                  checked={chainSlug === c.slug}
                  onChange={() => setChainSlug(c.slug)}
                  className="mt-1 accent-zinc-900"
                />
                <span>
                  <span className="font-medium">{c.name}</span>
                  {c.description && <span className="text-zinc-400"> — {c.description}</span>}
                </span>
              </label>
            ))}
          </div>
        </div>

        <div className="flex items-center gap-4">
          <button
            onClick={handleRun}
            disabled={running || !chain || !seedText.trim()}
            className="self-start rounded-lg bg-zinc-900 text-white px-8 py-2 text-sm font-medium
              disabled:opacity-40 hover:bg-zinc-700 transition-all active:scale-95"
          >
            {running ? 'Running...' : 'Run'}
          </button>
        </div>

        {error && <div className="text-xs text-red-600 bg-red-50 border border-red-100 rounded px-2 py-1.5">{error}</div>}
      </div>

      {frame && model && (
        <RunFrame frame={frame} runId={runId} selectedCount={deck.selected.length}>
          {model.kind === 'timeline' && <Timeline panels={model.panels} deck={deck} />}
          {model.kind === 'columns' && <Columns panels={model.panels} deck={deck} />}
          {model.kind === 'sidebar' && <Sidebar panels={model.panels} deck={deck} />}
          {model.kind === 'undeclared' && (
            // A chain that declares no layout is shown as the run trace it has always
            // had, rather than drawn in a shape it never asked for (#66).
            <RunTrace order={order} states={states} />
          )}
        </RunFrame>
      )}
    </div>
  )
}
