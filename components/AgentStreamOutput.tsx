'use client'

interface Props {
  agentName: string
  output: string
  isStreaming: boolean
  tokensIn?: number
  tokensOut?: number
  costUsd?: number
  latencyMs?: number
  status?: 'success' | 'error'
  error?: string
}

export function AgentStreamOutput({
  agentName, output, isStreaming,
  tokensIn, tokensOut, costUsd, latencyMs, status, error
}: Props) {
  return (
    <div className="rounded-xl border border-zinc-200 overflow-hidden">
      <div className="flex items-center justify-between px-4 py-2 bg-zinc-50 border-b border-zinc-200">
        <span className="text-sm font-medium text-zinc-700">{agentName}</span>
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
