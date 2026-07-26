'use client'
import { useState } from 'react'
import { CheckCircle2, AlertCircle, Brain, MessageSquare } from 'lucide-react'
import type { NodeRunState, RunStateMap } from '@/lib/runState'
import { narrationOf } from '@/lib/toolNarration'
import TokenCostBar from '@/components/TokenCostBar'
import { CollapsibleDetail } from '@/components/ui/CollapsibleDetail'
import { ToolLoopNarration } from '@/components/trace/ToolLoopNarration'
import { SaveToContextButton } from '@/components/SaveToContextButton'

function StatusIcon({ status }: { status: NodeRunState['status'] }) {
  if (status === 'success') return <CheckCircle2 size={14} className="text-green-500 shrink-0" />
  if (status === 'error') return <AlertCircle size={14} className="text-red-500 shrink-0" />
  if (status === 'running') return <div className="w-3.5 h-3.5 shrink-0 border-2 border-zinc-200 border-t-zinc-500 rounded-full animate-spin" />
  if (status === 'skipped') return <div className="w-3.5 h-3.5 shrink-0 rounded-full border-2 border-dashed border-zinc-300" />
  return <div className="w-3.5 h-3.5 shrink-0 rounded-full bg-zinc-200" />
}

function NodeRunPanel({ nodeId, state }: { nodeId: string; state: NodeRunState }) {
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

export function RunTrace({ order, states }: { order: string[]; states: RunStateMap }) {
  const [selected, setSelected] = useState<string | null>(null)
  const active = selected && states[selected] ? selected : order[order.length - 1] ?? null

  if (order.length === 0) {
    return <div className="text-sm text-zinc-300 italic py-8 text-center">Waiting for instance to start...</div>
  }

  return (
    <div className="grid grid-cols-1 md:grid-cols-[minmax(9rem,13rem)_1fr] rounded-xl border border-zinc-200 bg-white overflow-hidden">
      <div className="md:border-r border-b md:border-b-0 border-zinc-200 bg-zinc-50/60 flex md:flex-col overflow-x-auto">
        {order.map((id, i) => {
          const s = states[id]
          if (!s) return null
          return (
            <button
              key={id}
              onClick={() => setSelected(id)}
              className={`flex items-center gap-2 px-3 py-2.5 text-left md:border-b border-zinc-100 shrink-0 transition-colors ${
                active === id ? 'bg-white' : 'hover:bg-white/60'
              }`}
            >
              <span className="text-[10px] font-mono text-zinc-300 w-4 shrink-0">{i + 1}</span>
              <StatusIcon status={s.status} />
              <span className="flex-1 text-xs font-medium text-zinc-700 truncate">{s.agentName ?? id}</span>
              {s.rounds.length > 1 && (
                <span className="text-[9px] font-bold text-amber-600 shrink-0">×{s.rounds.length}</span>
              )}
            </button>
          )
        })}
      </div>

      {active && states[active]
        ? <NodeRunPanel key={active} nodeId={active} state={states[active]} />
        : <div className="p-6 text-sm text-zinc-300 italic">Select a step.</div>}
    </div>
  )
}
