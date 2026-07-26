'use client'
import { useState } from 'react'
import { CheckCircle2, AlertCircle, Wrench, ChevronDown, ChevronUp } from 'lucide-react'
import type { NarratedCall, NarratedTurn } from '@/lib/toolNarration'

// Chip latencies are usually sub-second, where the panel's own `x.xxs` reads as noise.
const fmtMs = (ms: number) => (ms >= 1000 ? `${(ms / 1000).toFixed(1)}s` : `${ms}ms`)

const CAPTION = 'text-[9px] font-bold uppercase tracking-widest'

function Chip({ call, isOpen, onToggle }: { call: NarratedCall; isOpen: boolean; onToggle: () => void }) {
  const running = call.status === 'running'
  const tone = call.isError
    ? 'border-red-200 bg-red-50 text-red-700 hover:bg-red-100'
    : running
      ? 'border-blue-200 bg-blue-50 text-blue-700'
      : 'border-zinc-200 bg-white text-zinc-600 hover:bg-zinc-50'

  return (
    <button
      onClick={onToggle}
      disabled={running}
      className={`flex items-center gap-1.5 rounded-full border pl-2 pr-2.5 py-1 text-[11px] font-medium transition-colors disabled:cursor-default ${tone}`}
      aria-expanded={isOpen}
    >
      {running ? (
        <div className="w-3 h-3 shrink-0 border-2 border-blue-200 border-t-blue-500 rounded-full animate-spin" />
      ) : call.isError ? (
        <AlertCircle size={12} className="shrink-0" />
      ) : (
        <CheckCircle2 size={12} className="shrink-0 text-green-500" />
      )}
      <span className="truncate max-w-52">{call.label}</span>
      {!running && <span className="font-mono text-[10px] opacity-60">{fmtMs(call.latencyMs)}</span>}
      {!running && (isOpen ? <ChevronUp size={11} className="opacity-50" /> : <ChevronDown size={11} className="opacity-50" />)}
    </button>
  )
}

// A result is markdown in its own right: the frame keeps its `##` from reading as
// one of the panel's own sections (#36).
function CallBody({ call }: { call: NarratedCall }) {
  return (
    <div className="mt-1.5 rounded-lg border border-zinc-200 bg-zinc-50/70 overflow-hidden">
      <div className="flex items-center justify-between gap-2 px-2.5 py-1 border-b border-zinc-200 bg-zinc-100/60">
        <span className={`${CAPTION} text-zinc-400`}>
          {call.name} {call.isError ? '— error' : 'result'}
        </span>
        <span className="font-mono text-[9px] text-zinc-400">{fmtMs(call.latencyMs)}</span>
      </div>
      <div className="px-2.5 py-2 border-b border-zinc-100">
        <div className={`${CAPTION} text-zinc-300 mb-1`}>args</div>
        <pre className="text-[10px] font-mono text-zinc-500 whitespace-pre-wrap break-words">{JSON.stringify(call.args, null, 2)}</pre>
      </div>
      <div className="px-2.5 py-2 max-h-72 overflow-y-auto">
        <pre className={`text-[10px] font-mono whitespace-pre-wrap break-words ${call.isError ? 'text-red-600' : 'text-zinc-600'}`}>
          {call.result || <span className="italic text-zinc-300">empty result</span>}
        </pre>
      </div>
    </div>
  )
}

function TurnRow({ turn }: { turn: NarratedTurn }) {
  const [open, setOpen] = useState<Set<number>>(new Set())
  const [showText, setShowText] = useState(false)

  const toggle = (i: number) => setOpen(prev => {
    const next = new Set(prev)
    if (!next.delete(i)) next.add(i)
    return next
  })

  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-baseline gap-2">
        <span className={`${CAPTION} text-zinc-400 shrink-0`}>Turn {turn.turn}</span>
        {!turn.pending && turn.calls.length > 1 && (
          <span className="text-[9px] font-mono text-zinc-300">{turn.calls.length} calls · {fmtMs(turn.latencyMs)}</span>
        )}
      </div>

      {turn.pending ? (
        <div className="flex items-center gap-1.5 rounded-full border border-zinc-200 bg-zinc-50 pl-2 pr-2.5 py-1 text-[11px] text-zinc-400 self-start">
          <Wrench size={11} className="shrink-0 animate-pulse" />
          <span>preparing tools…</span>
        </div>
      ) : (
        <div className="flex flex-wrap gap-1.5">
          {turn.calls.map((c, i) => (
            <Chip key={i} call={c} isOpen={open.has(i)} onToggle={() => toggle(i)} />
          ))}
        </div>
      )}

      {turn.turnText && (
        <div className="flex flex-col self-start max-w-full">
          <button
            onClick={() => setShowText(!showText)}
            className={`flex items-center gap-1 ${CAPTION} text-zinc-300 hover:text-zinc-500 transition-colors self-start`}
          >
            {showText ? <ChevronUp size={10} /> : <ChevronDown size={10} />}
            model text
          </button>
          {showText && (
            <div className="mt-1 rounded-lg border border-zinc-100 bg-white px-2.5 py-2 text-[11px] font-mono italic text-zinc-500 whitespace-pre-wrap">
              {turn.turnText}
            </div>
          )}
        </div>
      )}

      {turn.calls.map((c, i) => (open.has(i) ? <CallBody key={`body-${i}`} call={c} /> : null))}
    </div>
  )
}

export function ToolLoopNarration({ turns }: { turns: NarratedTurn[] }) {
  return (
    <div className="flex flex-col gap-3 px-4 py-3 border-b border-zinc-100 bg-zinc-50/30">
      {turns.map(t => <TurnRow key={t.turn} turn={t} />)}
    </div>
  )
}
