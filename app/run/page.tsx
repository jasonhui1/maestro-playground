'use client'
import { useState, useEffect } from 'react'
import { ChainSelector } from '@/components/ChainSelector'
import { TemplateSelector } from '@/components/TemplateSelector'
import { AgentStreamOutput } from '@/components/AgentStreamOutput'
import { ChainDef, AgentOutput, TemplateDef } from '@/lib/types'

interface AgentState {
  runIndex: number
  agentName: string
  step: number
  output: string
  thought?: string
  isStreaming: boolean
  systemPrompt?: string
  tokensIn?: number
  tokensOut?: number
  costUsd?: number
  latencyMs?: number
  status?: 'success' | 'error'
  error?: string
}

export default function RunPage() {
  const [chains, setChains] = useState<ChainDef[]>([])
  const [templates, setTemplates] = useState<TemplateDef[]>([])
  const [selectedChain, setSelectedChain] = useState('')
  const [seedPrompt, setSeedPrompt] = useState('')
  const [parallelCount, setParallelCount] = useState(1)
  const [agentStates, setAgentStates] = useState<AgentState[]>([])
  const [isRunning, setIsRunning] = useState(false)
  const [completedRuns, setCompletedRuns] = useState<string[]>([])

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

    const reader = res.body!.getReader()
    const decoder = new TextDecoder()
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
        
        let event
        try {
          event = JSON.parse(line.slice(6))
        } catch (e) {
          console.error('Error parsing SSE event:', e)
          continue
        }

        if (event.type === 'agent_start') {
          setAgentStates(prev => [...prev, {
            runIndex,
            agentName: event.agentName,
            step: event.step,
            output: '',
            isStreaming: true,
          }])
        }
        if (event.type === 'token') {
          setAgentStates(prev => prev.map(a => {
            if (a.runIndex === runIndex && a.agentName === event.agentName && a.step === event.step) {
              if (event.tokenType === 'thought') {
                return { ...a, thought: (a.thought || '') + event.token }
              }
              return { ...a, output: a.output + event.token }
            }
            return a
          }))
        }
        if (event.type === 'agent_done') {
          const o: AgentOutput = event.output
          setAgentStates(prev => prev.map(a =>
            a.runIndex === runIndex && a.agentName === event.agentName && a.step === event.step
              ? { ...a, isStreaming: false, ...o }
              : a
          ))
        }
        if (event.type === 'run_complete') {
          setCompletedRuns(prev => [...prev, event.runId])
        }
      }

      if (done) break
    }
  }

  async function handleRun() {
    setAgentStates([])
    setCompletedRuns([])
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
            <div className="flex flex-col gap-4">
              {agentStates.filter(a => a.runIndex === runIndex).length === 0 ? (
                <div className="text-sm text-zinc-300 italic py-8 text-center">Waiting for instance to start...</div>
              ) : (
                agentStates.filter(a => a.runIndex === runIndex).map(a => (
                  <AgentStreamOutput key={`${a.runIndex}-${a.agentName}-${a.step}`} {...a} />
                ))
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
