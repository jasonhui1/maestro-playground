'use client'

import { useState } from 'react'
import type { RunMeta, AgentOutput } from '@/lib/types'
import TokenCostBar from '@/components/TokenCostBar'
import { AgentStreamOutput } from '@/components/AgentStreamOutput'
import { GitFork, Play, X, CheckCircle2, AlertCircle } from 'lucide-react'
import { forkFromNode } from '@/lib/forkFromNode'

export interface DAGTraceViewProps {
  run: RunMeta
  initialBranchStepIndex?: number | null
  initialBranchOutputs?: AgentOutput[]
  onExecuteBranch?: (
    nodeId: string,
    opts: { promptOverride?: string; modelOverride?: string | null; stepIndex: number }
  ) => Promise<{ runId?: string; outputs?: AgentOutput[] } | void>
}

interface ActiveBranch {
  stepIndex: number
  nodeId: string
  promptOverride: string
  modelOverride: string
  status: 'idle' | 'running' | 'completed' | 'error'
  error?: string
  outputs?: AgentOutput[]
  forkedRunId?: string
}

// Tree trace with DAG forking and orthogonal topology (#143).
export function DAGTraceView({
  run,
  initialBranchStepIndex,
  initialBranchOutputs,
  onExecuteBranch,
}: DAGTraceViewProps) {
  const outputs = run.agentOutputs ?? []
  const [activeBranch, setActiveBranch] = useState<ActiveBranch | null>(() => {
    if (
      initialBranchStepIndex != null &&
      initialBranchStepIndex >= 0 &&
      initialBranchStepIndex < outputs.length
    ) {
      const step = outputs[initialBranchStepIndex]
      return {
        stepIndex: initialBranchStepIndex,
        nodeId: step?.nodeId || `step-${initialBranchStepIndex}`,
        promptOverride: step?.input || step?.systemPrompt || '',
        modelOverride: run.modelOverride || '',
        status: initialBranchOutputs ? 'completed' : 'idle',
        outputs: initialBranchOutputs,
      }
    }
    return null
  })

  function handleStartFork(index: number) {
    const step = outputs[index]
    const nodeId = step?.nodeId || `step-${index}`
    setActiveBranch({
      stepIndex: index,
      nodeId,
      promptOverride: step?.input || step?.systemPrompt || '',
      modelOverride: run.modelOverride || '',
      status: 'idle',
    })
  }

  function handleCollapseBranch() {
    setActiveBranch(null)
  }

  async function handleRunBranch() {
    if (!activeBranch) return
    setActiveBranch(prev => (prev ? { ...prev, status: 'running', error: undefined } : null))

    try {
      if (onExecuteBranch) {
        const res = await onExecuteBranch(activeBranch.nodeId, {
          promptOverride: activeBranch.promptOverride,
          modelOverride: activeBranch.modelOverride || null,
          stepIndex: activeBranch.stepIndex,
        })
        if (res && res.outputs) {
          setActiveBranch(prev =>
            prev
              ? {
                  ...prev,
                  status: 'completed',
                  outputs: res.outputs,
                  forkedRunId: res.runId,
                }
              : null
          )
          return
        }
      }

      const forkedId = await forkFromNode(run.runId, activeBranch.nodeId, {
        promptOverride: activeBranch.promptOverride,
        modelOverride: activeBranch.modelOverride || null,
      })
      if (!forkedId) throw new Error('Fork run did not produce a run ID')

      const res = await fetch(`/api/runs/${encodeURIComponent(forkedId)}`)
      if (!res.ok) throw new Error(`Failed to load forked run (${res.status})`)
      const data: RunMeta = await res.json()
      if (!data.agentOutputs || data.agentOutputs.length === 0) {
        throw new Error('Forked run returned no agent outputs')
      }

      setActiveBranch(prev =>
        prev
          ? {
              ...prev,
              status: 'completed',
              outputs: data.agentOutputs,
              forkedRunId: forkedId,
            }
          : null
      )
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Branch run failed'
      setActiveBranch(prev => (prev ? { ...prev, status: 'error', error: msg } : null))
    }
  }

  if (outputs.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-20 text-zinc-400 gap-2">
        <span className="text-xs font-semibold uppercase tracking-wider">No Execution Steps</span>
        <p className="text-xs text-zinc-500">This run has no recorded agent outputs.</p>
      </div>
    )
  }

  if (!activeBranch) {
    return (
      <div className="h-full overflow-auto p-6" data-testid="dag-trace-container">
        <div className="max-w-2xl mx-auto flex flex-col items-center" data-testid="dag-single-trunk">
          <div className="w-full flex flex-col items-center" data-testid="trunk-column">
            {outputs.map((step, idx) => (
              <div key={idx} className="w-full flex flex-col items-center">
                <TrunkStepCard
                  step={step}
                  index={idx}
                  onFork={() => handleStartFork(idx)}
                  isSharedAncestor={false}
                />
                {idx < outputs.length - 1 && <LinearWire testId="linear-wire" />}
              </div>
            ))}
          </div>
        </div>
      </div>
    )
  }

  const forkIdx = activeBranch.stepIndex
  const sharedAncestorIdx = forkIdx > 0 ? forkIdx - 1 : null

  return (
    <div className="h-full overflow-auto p-6" data-testid="dag-trace-container">
      <div className="max-w-5xl mx-auto overflow-x-auto pb-8" data-testid="dag-fork-view">
        {forkIdx === 0 && (
          <div className="w-full max-w-md mx-auto mb-3 flex flex-col items-center" data-testid="seed-root-card">
            <div className="w-full px-4 py-2 rounded-xl border border-zinc-200 bg-zinc-50 text-center flex flex-col gap-0.5 shadow-2xs">
              <span className="text-[10px] font-bold text-zinc-400 uppercase tracking-widest">Pipeline Root &bull; Seed</span>
              <span className="text-xs text-zinc-700 italic truncate">&ldquo;{run.seedPrompt || 'Root Entry'}&rdquo;</span>
            </div>
            <RootOrthogonalConnector />
          </div>
        )}

        <div className="min-w-[920px] flex justify-center gap-8 relative">
          <div className="flex-1 max-w-[440px] shrink-0 flex flex-col items-center" data-testid="trunk-column">
            <div className="w-full px-2 py-1 mb-3 flex items-center justify-between border-b border-zinc-200">
              <span className="text-[11px] font-bold text-zinc-500 uppercase tracking-wider">Trunk Execution</span>
              <span className="text-[10px] text-zinc-400 font-mono">Original Baseline</span>
            </div>

            {outputs.map((step, idx) => {
              const isShared = idx === sharedAncestorIdx

              return (
                <div key={idx} className="w-full flex flex-col items-center" data-testid={`trunk-step-${idx + 1}`}>
                  <TrunkStepCard
                    step={step}
                    index={idx}
                    onFork={() => handleStartFork(idx)}
                    isSharedAncestor={isShared}
                  />

                  {idx < outputs.length - 1 && (
                    <>
                      {isShared ? (
                        <OrthogonalForkConnector />
                      ) : (
                        <LinearWire testId="linear-trunk-wire" />
                      )}
                    </>
                  )}
                </div>
              )
            })}
          </div>

          <div className="flex-1 max-w-[440px] shrink-0 flex flex-col items-center" data-testid="branch-column">
            <div className="w-full px-2 py-1 mb-3 flex items-center justify-between border-b border-zinc-200">
              <div className="flex items-center gap-1.5">
                <GitFork size={13} className="text-zinc-700 rotate-180" />
                <span className="text-[11px] font-bold text-zinc-800 uppercase tracking-wider">Branch Lane</span>
              </div>
              <button
                onClick={handleCollapseBranch}
                className="text-xs text-zinc-500 hover:text-zinc-900 flex items-center gap-1 font-medium transition-colors cursor-pointer"
                data-testid="collapse-branch-btn"
              >
                <X size={13} />
                <span>✕ collapse branch</span>
              </button>
            </div>

            {outputs.map((step, idx) => {
              if (idx < forkIdx) {
                const isShared = idx === sharedAncestorIdx
                return (
                  <div key={idx} className="w-full flex flex-col items-center">
                    <SharedAncestorCard step={step} index={idx} isSharedAncestor={isShared} />
                    {idx < outputs.length - 1 && (
                      <div className="w-full h-10 flex items-center justify-center" aria-hidden="true" />
                    )}
                  </div>
                )
              }

              if (idx === forkIdx) {
                return (
                  <div key={idx} className="w-full flex flex-col items-center" data-testid={`branch-step-${idx + 1}`}>
                    <ForkedStepCard
                      step={step}
                      index={idx}
                      activeBranch={activeBranch}
                      onChangePrompt={p => setActiveBranch(prev => (prev ? { ...prev, promptOverride: p } : null))}
                      onChangeModel={m => setActiveBranch(prev => (prev ? { ...prev, modelOverride: m } : null))}
                      onRunBranch={handleRunBranch}
                      onCollapseBranch={handleCollapseBranch}
                    />
                    {idx < outputs.length - 1 && <LinearWire testId="linear-branch-wire" />}
                  </div>
                )
              }

              const adaptedStep = activeBranch.outputs ? activeBranch.outputs[idx] : null
              return (
                <div key={idx} className="w-full flex flex-col items-center">
                  {adaptedStep && activeBranch.status === 'completed' ? (
                    <AdaptedDownstreamCard
                      step={adaptedStep}
                      originalName={step.agentName}
                      index={idx}
                    />
                  ) : (
                    <PendingDownstreamCard
                      step={step}
                      index={idx}
                    />
                  )}
                  {idx < outputs.length - 1 && <LinearWire testId="linear-branch-wire" />}
                </div>
              )
            })}
          </div>
        </div>
      </div>
    </div>
  )
}

function TrunkStepCard({
  step,
  index,
  onFork,
  isSharedAncestor,
}: {
  step: AgentOutput
  index: number
  onFork: () => void
  isSharedAncestor: boolean
}) {
  return (
    <div
      className={`w-full flex flex-col border rounded-xl overflow-hidden bg-white shadow-xs transition-shadow hover:shadow-sm ${
        isSharedAncestor ? 'border-zinc-400 ring-2 ring-zinc-200' : 'border-zinc-200'
      }`}
    >
      <div className="bg-zinc-50 px-4 py-3 border-b border-zinc-200 flex flex-col gap-2.5 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-2.5 min-w-0">
          <div className="w-6 h-6 rounded-full bg-zinc-900 text-white flex items-center justify-center text-[11px] font-bold shrink-0">
            {index + 1}
          </div>
          <div className="flex flex-col min-w-0">
            <span className="text-sm font-bold text-zinc-900 truncate">{step.agentName}</span>
            <span className="text-[10px] font-medium text-zinc-400 uppercase tracking-wider">
              {step.model} &bull; {step.latencyMs}ms
            </span>
          </div>
        </div>

        <div className="flex items-center gap-3 shrink-0">
          <div className="w-24 sm:w-28">
            <TokenCostBar tokensIn={step.tokensIn} tokensOut={step.tokensOut} costUsd={step.costUsd} />
          </div>
          <button
            onClick={onFork}
            className="flex items-center gap-1 px-2.5 py-1 rounded-md text-xs font-semibold border border-zinc-200 text-zinc-700 bg-white hover:bg-zinc-50 hover:border-zinc-900 transition-colors shadow-2xs cursor-pointer"
            title={`Fork from Step ${index + 1}`}
            data-testid={`fork-btn-step-${index + 1}`}
          >
            <GitFork size={12} className="rotate-180" />
            <span>⑂ fork</span>
          </button>
        </div>
      </div>

      <div className="p-3 max-h-56 overflow-auto">
        <AgentStreamOutput {...step} isStreaming={false} />
      </div>
    </div>
  )
}

function SharedAncestorCard({
  step,
  index,
  isSharedAncestor,
}: {
  step: AgentOutput
  index: number
  isSharedAncestor: boolean
}) {
  return (
    <div
      className={`w-full flex flex-col border border-dashed rounded-xl overflow-hidden bg-zinc-50/50 shadow-2xs opacity-75 ${
        isSharedAncestor ? 'border-zinc-400 ring-2 ring-zinc-100' : 'border-zinc-200'
      }`}
    >
      <div className="bg-zinc-100/70 px-4 py-2.5 border-b border-dashed border-zinc-200 flex items-center justify-between">
        <div className="flex items-center gap-2 min-w-0">
          <div className="w-5 h-5 rounded-full bg-zinc-300 text-zinc-700 flex items-center justify-center text-[10px] font-bold shrink-0">
            {index + 1}
          </div>
          <span className="text-xs font-semibold text-zinc-600 truncate">{step.agentName}</span>
        </div>
        <span className="text-[10px] font-bold text-zinc-500 uppercase tracking-wider bg-zinc-200/80 px-2 py-0.5 rounded">
          {isSharedAncestor ? `Shared Ancestor (Step ${index + 1})` : 'Shared Ancestor'}
        </span>
      </div>
      <div className="p-3 max-h-56 overflow-auto">
        <AgentStreamOutput {...step} isStreaming={false} />
      </div>
    </div>
  )
}

function ForkedStepCard({
  step,
  index,
  activeBranch,
  onChangePrompt,
  onChangeModel,
  onRunBranch,
  onCollapseBranch,
}: {
  step: AgentOutput
  index: number
  activeBranch: ActiveBranch
  onChangePrompt: (p: string) => void
  onChangeModel: (m: string) => void
  onRunBranch: () => void
  onCollapseBranch: () => void
}) {
  return (
    <div className="w-full flex flex-col border border-zinc-900 rounded-xl overflow-hidden bg-white shadow-md">
      <div className="bg-zinc-900 text-white px-4 py-3 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="px-2 py-0.5 rounded bg-zinc-800 text-zinc-100 text-[10px] font-bold uppercase tracking-wider">
            Branch Step {index + 1}
          </span>
          <span className="text-sm font-bold truncate">{step.agentName}</span>
        </div>
        <button
          onClick={onCollapseBranch}
          className="text-zinc-400 hover:text-white p-1 transition-colors cursor-pointer"
          title="Collapse branch"
          data-testid="collapse-branch-icon-btn"
        >
          <X size={14} />
        </button>
      </div>

      <div className="p-4 flex flex-col gap-3">
        <div className="flex flex-col gap-1">
          <label className="text-[11px] font-bold text-zinc-700 uppercase tracking-wider">
            Prompt / Input Override
          </label>
          <textarea
            value={activeBranch.promptOverride}
            onChange={e => onChangePrompt(e.target.value)}
            placeholder="Enter override prompt or input for this step..."
            rows={3}
            className="w-full text-xs font-mono p-2.5 border border-zinc-200 rounded-lg bg-white focus:outline-none focus:ring-1 focus:ring-zinc-900"
            data-testid="branch-prompt-override"
          />
        </div>

        <div className="flex items-center gap-2">
          <label className="text-[11px] font-medium text-zinc-600 shrink-0">Model Override:</label>
          <input
            type="text"
            value={activeBranch.modelOverride}
            onChange={e => onChangeModel(e.target.value)}
            placeholder="e.g. gpt-4o (optional)"
            className="flex-1 text-xs px-2.5 py-1 border border-zinc-200 rounded-md focus:outline-none focus:ring-1 focus:ring-zinc-900 bg-white"
            data-testid="branch-model-override"
          />
        </div>

        <div className="flex items-center justify-between pt-1">
          <button
            onClick={onRunBranch}
            disabled={activeBranch.status === 'running'}
            className="px-3.5 py-1.5 rounded-lg bg-zinc-900 text-white text-xs font-bold hover:bg-zinc-800 disabled:opacity-50 flex items-center gap-1.5 transition-colors cursor-pointer shadow-xs"
            data-testid="run-branch-btn"
          >
            {activeBranch.status === 'running' ? (
              <>
                <div className="w-3 h-3 border-2 border-zinc-400 border-t-white rounded-full animate-spin" />
                <span>Running branch...</span>
              </>
            ) : (
              <>
                <Play size={12} fill="currentColor" />
                <span>Run branch</span>
              </>
            )}
          </button>

          {activeBranch.status === 'completed' && (
            <span className="text-[11px] font-bold text-emerald-600 flex items-center gap-1">
              <CheckCircle2 size={13} />
              Branch executed
            </span>
          )}
        </div>

        {activeBranch.status === 'error' && (
          <div className="p-2.5 rounded-lg bg-red-50 border border-red-200 text-xs text-red-600 flex items-center gap-1.5">
            <AlertCircle size={14} className="shrink-0" />
            <span>{activeBranch.error || 'Branch execution failed'}</span>
          </div>
        )}

        {activeBranch.status === 'completed' && activeBranch.outputs && activeBranch.outputs[index] && (
          <div className="mt-2 pt-3 border-t border-zinc-100 flex flex-col gap-1.5">
            <div className="flex items-center justify-between">
              <span className="text-[10px] font-bold text-zinc-500 uppercase tracking-wider">Branch Output</span>
              <span className="text-[10px] text-zinc-400 font-mono">
                {activeBranch.outputs[index].model} &bull; {activeBranch.outputs[index].latencyMs}ms
              </span>
            </div>
            <div className="p-2.5 bg-zinc-50 rounded-lg text-xs font-mono text-zinc-800 whitespace-pre-wrap max-h-52 overflow-auto border border-zinc-200">
              {activeBranch.outputs[index].output}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

function PendingDownstreamCard({ step, index }: { step: AgentOutput; index: number }) {
  return (
    <div
      className="w-full border border-dashed border-zinc-200 rounded-xl p-4 bg-zinc-50/50 flex flex-col gap-2"
      data-testid={`branch-pending-step-${index + 1}`}
    >
      <div className="flex items-center justify-between">
        <span className="text-xs font-bold text-zinc-500">Step {index + 1} &bull; {step.agentName}</span>
        <span className="text-[10px] font-semibold text-zinc-400 uppercase tracking-wider">Pending Execution</span>
      </div>
      <p className="text-xs text-zinc-400 italic">
        Downstream output will adapt once the branch is executed.
      </p>
    </div>
  )
}

function AdaptedDownstreamCard({
  step,
  originalName,
  index,
}: {
  step: AgentOutput
  originalName: string
  index: number
}) {
  return (
    <div
      className="w-full border border-emerald-300 rounded-xl overflow-hidden bg-white shadow-xs"
      data-testid={`branch-adapted-step-${index + 1}`}
    >
      <div className="bg-emerald-50/70 px-4 py-3 border-b border-emerald-200 flex items-center justify-between">
        <div className="flex items-center gap-2.5">
          <div className="w-6 h-6 rounded-full bg-emerald-700 text-white flex items-center justify-center text-[11px] font-bold shrink-0">
            {index + 1}
          </div>
          <div className="flex flex-col">
            <span className="text-sm font-bold text-zinc-900">{step.agentName || originalName}</span>
            <span className="text-[10px] font-medium text-zinc-500 uppercase tracking-wider">
              {step.model} &bull; {step.latencyMs}ms
            </span>
          </div>
        </div>
        <span className="text-[10px] font-bold text-emerald-800 bg-emerald-100 px-2 py-0.5 rounded uppercase tracking-wider">
          Adapted
        </span>
      </div>

      <div className="p-3 max-h-56 overflow-auto">
        <AgentStreamOutput {...step} isStreaming={false} />
      </div>
    </div>
  )
}

// 1px orthogonal linear wire connector (#143).
function LinearWire({ testId }: { testId: string }) {
  return (
    <div className="flex flex-col items-center my-2 h-7 justify-center" data-testid={testId}>
      <div className="w-px h-5 bg-zinc-300" />
      <span className="text-[9px] text-zinc-400 select-none leading-none -mt-0.5">▼</span>
    </div>
  )
}

// Orthogonal fork connector bridging shared ancestor into branch column (#143).
function OrthogonalForkConnector() {
  return (
    <div className="w-full h-10 relative" data-testid="orthogonal-fork-connector">
      <div className="absolute top-0 left-1/2 -translate-x-1/2 w-px h-5 bg-zinc-300" />
      <div
        className="absolute top-5 left-1/2 h-px bg-zinc-300"
        style={{ width: 'calc(100% + 2rem)' }}
      />
      <div className="absolute top-5 left-1/2 -translate-x-1/2 w-px h-5 bg-zinc-300" />
      <span className="absolute bottom-0 left-1/2 -translate-x-1/2 text-[9px] text-zinc-400 select-none leading-none -mb-1">
        ▼
      </span>
      <div
        className="absolute top-5 w-px h-5 bg-zinc-300"
        style={{ left: 'calc(150% + 2rem)' }}
      />
      <span
        className="absolute bottom-0 text-[9px] text-zinc-400 select-none leading-none -mb-1"
        style={{ left: 'calc(150% + 2rem)', transform: 'translateX(-50%)' }}
      >
        ▼
      </span>
    </div>
  )
}

// Root-level orthogonal connector for Step 1 fork (#143).
function RootOrthogonalConnector() {
  return (
    <div className="w-full h-9 relative" data-testid="root-orthogonal-fork-connector">
      <div className="absolute top-0 left-1/2 -translate-x-1/2 w-px h-4 bg-zinc-300" />
      <div
        className="absolute top-4 left-1/2 -translate-x-1/2 h-px bg-zinc-300"
        style={{ width: 'calc(100% + 2rem)' }}
      />
      <div
        className="absolute top-4 w-px h-5 bg-zinc-300"
        style={{ left: 'calc(0% - 1rem)' }}
      />
      <span
        className="absolute bottom-0 text-[9px] text-zinc-400 select-none leading-none -mb-1"
        style={{ left: 'calc(0% - 1rem)', transform: 'translateX(-50%)' }}
      >
        ▼
      </span>
      <div
        className="absolute top-4 w-px h-5 bg-zinc-300"
        style={{ left: 'calc(100% + 1rem)' }}
      />
      <span
        className="absolute bottom-0 text-[9px] text-zinc-400 select-none leading-none -mb-1"
        style={{ left: 'calc(100% + 1rem)', transform: 'translateX(-50%)' }}
      >
        ▼
      </span>
    </div>
  )
}
