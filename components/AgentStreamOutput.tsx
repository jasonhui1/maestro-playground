'use client'
import { useState } from 'react'

interface Props {
  agentName: string
  output: string
  isStreaming: boolean
  systemPrompt?: string
  thought?: string
  tokensIn?: number
  tokensOut?: number
  costUsd?: number
  latencyMs?: number
  status?: 'success' | 'error'
  error?: string
}

export function AgentStreamOutput({
  agentName, output, isStreaming, systemPrompt, thought,
  tokensIn, tokensOut, costUsd, latencyMs, status, error
}: Props) {
  const [showSystemPrompt, setShowSystemPrompt] = useState(false)
  const [showThought, setShowThought] = useState(false)

  return (
    <div className="rounded-xl border border-zinc-200 overflow-hidden">
      <div className="flex items-center justify-between px-4 py-2 bg-zinc-50 border-b border-zinc-200">
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium text-zinc-700">{agentName}</span>
          {systemPrompt && (
            <button
              onClick={() => setShowSystemPrompt(!showSystemPrompt)}
              className="text-[10px] bg-zinc-200 text-zinc-600 px-1.5 py-0.5 rounded hover:bg-zinc-300 transition-colors uppercase tracking-wider font-bold"
            >
              {showSystemPrompt ? 'Hide Prompt' : 'View Prompt'}
            </button>
          )}
          {thought && (
            <button
              onClick={() => setShowThought(!showThought)}
              className="text-[10px] bg-zinc-200 text-zinc-600 px-1.5 py-0.5 rounded hover:bg-zinc-300 transition-colors uppercase tracking-wider font-bold"
            >
              {showThought ? 'Hide Thinking' : 'Thinking'}
            </button>
          )}
        </div>
        <div className="flex items-center gap-3 text-xs text-zinc-400">
          {tokensIn != null && <span>{tokensIn + (tokensOut ?? 0)} tokens</span>}
          {costUsd != null && <span>${costUsd.toFixed(5)}</span>}
          {latencyMs != null && <span>{(latencyMs / 1000).toFixed(1)}s</span>}
          {isStreaming && (
            <span className="text-blue-500 animate-pulse">streaming...</span>
          )}
          {status === 'error' && (
            <span className="text-red-500">error</span>
          )}
        </div>
      </div>

      {showSystemPrompt && (
        <div className="p-4 bg-zinc-100 border-b border-zinc-200 text-[11px] text-zinc-500 font-mono whitespace-pre-wrap max-h-60 overflow-y-auto">
          <div className="mb-2 font-bold text-zinc-400 uppercase tracking-widest">System Prompt</div>
          {systemPrompt}
        </div>
      )}

      {showThought && (
        <div className="p-4 bg-zinc-50 border-b border-zinc-200 text-[11px] text-zinc-400 font-mono whitespace-pre-wrap max-h-60 overflow-y-auto italic">
          <div className="mb-2 font-bold text-zinc-300 uppercase tracking-widest not-italic">Thinking Process</div>
          {thought}
        </div>
      )}

      <div className="p-4 text-sm text-zinc-700 whitespace-pre-wrap font-mono leading-relaxed min-h-16">
        {error ? (
          <span className="text-red-500">{error}</span>
        ) : output || (
          <span className="text-zinc-300">waiting...</span>
        )}
      </div>
    </div>
  )
}
