'use client'
import { useState, useRef } from 'react'
import {
  Info,
  CheckCircle2,
  AlertCircle,
  Brain,
  MessageSquare
} from 'lucide-react'
import { CollapsibleDetail } from '@/components/ui/CollapsibleDetail'
import { SaveToContextButton } from '@/components/SaveToContextButton'

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
  status?: 'success' | 'error' | 'skipped'
  error?: string
  className?: string
}

export function AgentStreamOutput({
  agentName, output, isStreaming, systemPrompt, thought,
  tokensIn, tokensOut, costUsd, latencyMs, status, error,
  className
}: Props) {
  const [showInput, setShowInput] = useState(false)
  const [showThinking, setShowThinking] = useState(false)
  const [showMetrics, setShowMetrics] = useState(false)

  const metricsButtonRef = useRef<HTMLButtonElement>(null)

  const formatCost = (cost: number) => {
    if (cost === 0) return '$0.00'
    if (cost < 0.00001) return '<$0.00001'
    return `$${cost.toFixed(5)}`
  }

  return (
    <div className={`rounded-xl border border-zinc-200 overflow-hidden bg-white shadow-sm flex flex-col relative ${className || ''}`}>
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-2 bg-zinc-50 border-b border-zinc-200">
        <div className="flex items-center gap-2">
          {status === 'success' ? (
            <CheckCircle2 size={14} className="text-green-500" />
          ) : status === 'error' ? (
            <AlertCircle size={14} className="text-red-500" />
          ) : (
            <div className="w-3.5 h-3.5 border-2 border-zinc-200 border-t-zinc-500 rounded-full animate-spin" />
          )}
          <span className="text-sm font-bold text-zinc-900 tracking-tight">{agentName}</span>
          
          {status === 'success' && (
            <span className="bg-green-100 text-green-700 text-[10px] px-1.5 py-0.25 rounded font-bold uppercase tracking-wider">Success</span>
          )}
          {status === 'error' && (
            <span className="bg-red-100 text-red-700 text-[10px] px-1.5 py-0.25 rounded font-bold uppercase tracking-wider">Error</span>
          )}
        </div>

        <div className="flex items-center gap-2">
          {/* Metrics Info Icon */}
          <div className="relative">
            <button
              ref={metricsButtonRef}
              onMouseEnter={() => setShowMetrics(true)}
              onMouseLeave={() => setShowMetrics(false)}
              onFocus={() => setShowMetrics(true)}
              onBlur={() => setShowMetrics(false)}
              className="p-1 text-zinc-400 hover:text-zinc-600 focus:text-zinc-600 outline-none transition-colors"
              aria-label="View Metrics"
            >
              <Info size={16} />
            </button>
            
            {showMetrics && (tokensIn != null || latencyMs != null) && (
              <div className="absolute right-0 top-full mt-1 z-20 bg-zinc-900 text-white p-3 rounded-lg shadow-xl border border-zinc-800 min-w-40 flex flex-col gap-2 animate-in fade-in zoom-in-95 duration-100">
                <div className="text-[10px] font-bold text-zinc-500 uppercase tracking-widest border-b border-zinc-800 pb-1 mb-1">
                  Agent Metrics
                </div>
                {tokensIn != null && (
                  <div className="flex justify-between items-center gap-4">
                    <span className="text-[10px] text-zinc-400">Tokens</span>
                    <span className="text-xs font-mono">{tokensIn + (tokensOut ?? 0)}</span>
                  </div>
                )}
                {costUsd != null && (
                  <div className="flex justify-between items-center gap-4">
                    <span className="text-[10px] text-zinc-400">Cost</span>
                    <span className="text-xs font-mono">{formatCost(costUsd)}</span>
                  </div>
                )}
                {latencyMs != null && (
                  <div className="flex justify-between items-center gap-4">
                    <span className="text-[10px] text-zinc-400">Latency</span>
                    <span className="text-xs font-mono">{(latencyMs / 1000).toFixed(2)}s</span>
                  </div>
                )}
              </div>
            )}
          </div>

          {!isStreaming && output && <SaveToContextButton agentName={agentName} output={output} />}

          {isStreaming && (
            <span className="text-[10px] font-bold text-blue-500 uppercase animate-pulse">Streaming</span>
          )}
        </div>
      </div>

      {/* Collapsible Sections (Input & Thinking) */}
      {systemPrompt && (
        <CollapsibleDetail
          title="Input"
          label="System Prompt"
          icon={<MessageSquare size={12} />}
          isOpen={showInput}
          onToggle={() => setShowInput(!showInput)}
          className="text-zinc-500 whitespace-pre-wrap"
        >
          {systemPrompt}
        </CollapsibleDetail>
      )}

      {thought && (
        <CollapsibleDetail
          title="Thinking"
          label="Thought Process"
          icon={<Brain size={12} />}
          isOpen={showThinking}
          onToggle={() => setShowThinking(!showThinking)}
          className="text-zinc-400 italic whitespace-pre-wrap"
          iconClassName={showThinking ? "text-amber-500" : ""}
        >
          {thought}
        </CollapsibleDetail>
      )}

      <div className="p-4 text-sm text-zinc-700 whitespace-pre-wrap font-mono leading-relaxed min-h-[4rem]">
        {error ? (
          <div className="flex items-center gap-2 text-red-500 bg-red-50/50 p-3 rounded border border-red-100">
            <AlertCircle size={14} />
            <span>{error}</span>
          </div>
        ) : output || (
          <span className="text-zinc-300 italic">Waiting for agent output...</span>
        )}
      </div>
    </div>
  )
}
