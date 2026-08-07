'use client'
import { useState } from 'react'
import { AlertCircle, Brain, MessageSquare } from 'lucide-react'
import type { NodeRunState } from '@/lib/runState'
import { narrationOf } from '@/lib/toolNarration'
import TokenCostBar from '@/components/TokenCostBar'
import { CollapsibleDetail } from '@/components/ui/CollapsibleDetail'
import { ToolLoopNarration } from '@/components/trace/ToolLoopNarration'
import { SectionWarnings } from '@/components/trace/SectionWarnings'
import { SaveToContextButton } from '@/components/SaveToContextButton'

export function NodeRunPanel({ nodeId, state }: { nodeId: string; state: NodeRunState }) {
  const [round, setRound] = useState<number | null>(null)
  const [showPrompt, setShowPrompt] = useState(false)
  const [showThinking, setShowThinking] = useState(false)
  const r = state.result
  const looped = state.rounds.length > 1
  // null round means "latest": a live loop shows the streaming buffer, not an archived round
  const viewingArchivedRound = looped && round !== null
  const narration = narrationOf(state)
  const shown = viewingArchivedRound
    ? state.rounds.find(x => x.round === round)?.output ?? ''
    : narration.answer

  return (
    <div className="flex flex-col min-w-0 relative">
      <div className="flex items-center justify-between gap-4 px-4 py-2.5 border-b border-zinc-200">
        <div className="flex items-center gap-2 min-w-0">
          <span className="text-sm font-bold text-zinc-900 truncate">{state.agentName ?? nodeId}</span>
          <span className="text-[10px] font-mono text-zinc-400 truncate">{nodeId}</span>
          {state.status === 'running' && (
            <span className="text-[10px] font-bold text-blue-500 uppercase animate-pulse shrink-0">Streaming</span>
          )}
        </div>
        <div className="flex items-center gap-3 shrink-0">
          {r && (
            <>
              <div className="w-40">
                <TokenCostBar tokensIn={r.tokensIn} tokensOut={r.tokensOut} costUsd={r.costUsd} />
              </div>
              <span className="text-[10px] font-mono text-zinc-400">{(r.latencyMs / 1000).toFixed(2)}s</span>
            </>
          )}
          {state.status !== 'running' && shown && (
            <SaveToContextButton agentName={state.agentName ?? nodeId} output={shown} />
          )}
        </div>
      </div>

      <SectionWarnings warnings={state.warnings} />

      {looped && (
        <div className="flex flex-wrap gap-1 px-4 py-2 border-b border-zinc-100">
          {state.rounds.map(x => (
            <button
              key={x.round}
              onClick={() => setRound(x.round)}
              className={`text-[10px] font-bold uppercase tracking-wider px-2 py-1 rounded transition-colors ${
                round === x.round ? 'bg-zinc-900 text-white' : 'bg-zinc-100 text-zinc-500 hover:bg-zinc-200'
              }`}
            >
              Round {x.round}
            </button>
          ))}
          {state.status === 'running' && (
            <button
              onClick={() => setRound(null)}
              className={`text-[10px] font-bold uppercase tracking-wider px-2 py-1 rounded transition-colors ${
                round === null ? 'bg-blue-600 text-white' : 'bg-blue-50 text-blue-500 hover:bg-blue-100'
              }`}
            >
              Live
            </button>
          )}
        </div>
      )}

      {/* like thought, the transcript is the latest round's — don't pair it with an archived one */}
      {narration.isNarrating && !viewingArchivedRound && <ToolLoopNarration turns={narration.turns} />}

      <div className="p-4 text-sm text-zinc-700 whitespace-pre-wrap font-mono leading-relaxed flex-1 min-h-[8rem] overflow-x-auto">
        {r?.error && !viewingArchivedRound ? (
          <div className="flex items-start gap-2 text-red-500 bg-red-50/50 p-3 rounded border border-red-100">
            <AlertCircle size={14} className="mt-0.5 shrink-0" />
            <span>{r.error}</span>
          </div>
        ) : state.status === 'skipped' ? (
          <span className="text-zinc-300 italic">Skipped — this node did not run.</span>
        ) : shown || <span className="text-zinc-300 italic">Waiting for agent output...</span>}
      </div>

      {/* thought is per-node, not per-round: hide it rather than pair it with an archived round */}
      {state.thought && !viewingArchivedRound && (
        <CollapsibleDetail
          title="Thinking"
          label="Thought Process"
          icon={<Brain size={12} />}
          isOpen={showThinking}
          onToggle={() => setShowThinking(!showThinking)}
          className="text-zinc-400 italic whitespace-pre-wrap"
          iconClassName={showThinking ? 'text-amber-500' : ''}
        >
          {state.thought}
        </CollapsibleDetail>
      )}

      {r?.systemPrompt && (
        <CollapsibleDetail
          title="Input"
          label="System Prompt"
          icon={<MessageSquare size={12} />}
          isOpen={showPrompt}
          onToggle={() => setShowPrompt(!showPrompt)}
          className="text-zinc-500 whitespace-pre-wrap"
        >
          {r.systemPrompt}
        </CollapsibleDetail>
      )}
    </div>
  )
}
