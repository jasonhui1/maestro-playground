'use client'
import React from 'react'
import type { RunMeta } from '@/lib/types'
import type { TraceNode } from '@/lib/graph'
import { AgentStreamOutput } from '@/components/AgentStreamOutput'
import TokenCostBar from '@/components/TokenCostBar'

export default function RunNodePreview({ node, run, onBranch, isBranching }: {
  node: TraceNode | null
  run: RunMeta
  onBranch: (step: number) => void
  isBranching: boolean
}) {
  if (!node) {
    return (
      <div className="border border-dashed border-zinc-200 rounded-2xl p-8 text-center text-sm text-zinc-400">
        Click a node to preview its output.
      </div>
    )
  }

  if (node.kind === 'seed') {
    return (
      <div className="border border-zinc-200 rounded-2xl p-6 bg-zinc-50">
        <h3 className="text-[10px] font-bold uppercase tracking-[0.2em] text-zinc-400 mb-3">Seed Prompt</h3>
        <p className="text-base text-zinc-800 italic">&quot;{run.seedPrompt}&quot;</p>
      </div>
    )
  }

  if (node.kind === 'context') {
    return (
      <div className="border border-amber-200 rounded-2xl p-6 bg-amber-50">
        <h3 className="text-[10px] font-bold uppercase tracking-[0.2em] text-amber-700 mb-2">Context File</h3>
        <p className="font-mono text-sm text-zinc-900">{node.fileName}.md</p>
      </div>
    )
  }

  // agent
  if (node.stale) {
    return (
      <div className="border border-zinc-200 rounded-2xl p-6 bg-zinc-50 text-sm text-zinc-500">
        <span className="font-bold text-zinc-900">{node.label}</span> is referenced by the chain but did not run in this execution.
      </div>
    )
  }

  const output = node.stepIndex != null ? run.agentOutputs[node.stepIndex] : undefined
  if (!output) return null

  return (
    <div className="border border-zinc-200 rounded-2xl overflow-hidden bg-white">
      <div className="bg-zinc-50 px-6 py-4 border-b border-zinc-200 flex items-center justify-between gap-4">
        <div className="flex flex-col">
          <span className="text-sm font-bold text-zinc-900">{output.agentName}</span>
          <span className="text-[10px] font-medium text-zinc-400 uppercase tracking-wider">{output.model} • {output.latencyMs}ms</span>
        </div>
        <div className="flex items-center gap-4">
          <button
            onClick={() => node.stepIndex != null && onBranch(node.stepIndex)}
            disabled={isBranching}
            className="text-[10px] font-bold text-zinc-400 hover:text-zinc-900 border border-zinc-200 rounded-md px-3 py-1.5 transition-all hover:bg-zinc-50 disabled:opacity-50 whitespace-nowrap"
          >
            {isBranching ? 'BRANCHING...' : 'BRANCH FROM HERE'}
          </button>
          <div className="w-48">
            <TokenCostBar tokensIn={output.tokensIn} tokensOut={output.tokensOut} costUsd={output.costUsd} />
          </div>
        </div>
      </div>
      <div className="p-4">
        <AgentStreamOutput {...output} isStreaming={false} />
      </div>
    </div>
  )
}
