'use client'
import { useState, useEffect } from 'react'
import { ChainSelector } from '@/components/ChainSelector'
import { TemplateSelector } from '@/components/TemplateSelector'
import { AgentStreamOutput } from '@/components/AgentStreamOutput'
import { ChainDef, AgentOutput, TemplateDef } from '@/lib/types'

interface AgentState {
  agentName: string
  step: number
  output: string
  isStreaming: boolean
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
  const [agentStates, setAgentStates] = useState<AgentState[]>([])
  const [isRunning, setIsRunning] = useState(false)
  const [completedRunId, setCompletedRunId] = useState<string | null>(null)

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

  async function handleRun() {
    setAgentStates([])
    setCompletedRunId(null)
    setIsRunning(true)

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
            agentName: event.agentName,
            step: event.step,
            output: '',
            isStreaming: true,
          }])
        }
        if (event.type === 'token') {
          setAgentStates(prev => prev.map(a =>
            a.agentName === event.agentName && a.step === event.step
              ? { ...a, output: a.output + event.token }
              : a
          ))
        }
        if (event.type === 'agent_done') {
          const o: AgentOutput = event.output
          setAgentStates(prev => prev.map(a =>
            a.agentName === event.agentName && a.step === event.step
              ? { ...a, isStreaming: false, ...o }
              : a
          ))
        }
        if (event.type === 'run_complete') {
          setCompletedRunId(event.runId)
          setIsRunning(false)
        }
      }
    }
  }

  return (
    <div className="max-w-3xl mx-auto px-6 py-10 flex flex-col gap-6">
      <h1 className="text-2xl font-semibold text-zinc-800">Run a chain</h1>

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
          className="rounded-lg border border-zinc-200 px-3 py-2 text-sm resize-none"
        />
      </div>

      <button
        onClick={handleRun}
        disabled={isRunning || !seedPrompt || !selectedChain}
        className="self-start rounded-lg bg-zinc-900 text-white px-5 py-2 text-sm
          disabled:opacity-40 hover:bg-zinc-700 transition-colors"
      >
        {isRunning ? 'Running...' : 'Run chain'}
      </button>

      {agentStates.map(a => (
        <AgentStreamOutput key={`${a.agentName}-${a.step}`} {...a} />
      ))}

      {completedRunId && (
        <p className="text-xs text-zinc-400">
          Run saved: <code>{completedRunId}</code>
        </p>
      )}
    </div>
  )
}
