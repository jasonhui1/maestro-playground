import { NextResponse } from 'next/server'
import { initRunDir } from './logger'
import { downstreamIds } from './partialRun'
import { contextOverrides, loadContinuation, newRunId, streamChainRun } from './runSession'
import type { AgentOutput, HoldRecord, RunMeta } from './types'

const recordKey = (o: AgentOutput) => (o.nodeId ? `${o.nodeId}|${o.round ?? ''}` : o)

/**
 * Revisiting history forks instead of rewriting it (#99): a new run of the source's
 * graph, replaying every output but the anchor and its descendants, then `replacement`
 * as the anchor's output. Holds below the anchor are asked again.
 */
export function forkRun(
  source: RunMeta,
  anchor: string,
  replacement: { output: AgentOutput; hold?: HoldRecord },
  context: unknown,
): Response {
  const continuation = loadContinuation(source)
  if ('error' in continuation) {
    const { error, errors, status } = continuation
    return NextResponse.json({ error, errors }, { status })
  }
  const graph = source.graph!
  const dropped = downstreamIds(graph, anchor).add(anchor)
  const kept = source.agentOutputs.filter(o => !o.nodeId || !dropped.has(o.nodeId))
  // Repeated records from an in-place promote collapse to the latest, so each node logs once.
  const latest = new Map(kept.map(o => [recordKey(o), o]))
  const replay = [...kept.filter(o => latest.get(recordKey(o)) === o), replacement.output]
  const holds = [
    ...(source.holds ?? []).filter(h => !dropped.has(h.nodeId)),
    ...(replacement.hold ? [replacement.hold] : []),
  ]

  const { chain, workspace, versionNumber, versions } = continuation
  const runId = newRunId()
  initRunDir({
    runId,
    chainName: source.chainName,
    seedPrompt: source.seedPrompt,
    parameter: source.parameter,
    startedAt: new Date().toISOString(),
    status: 'running',
    agentOutputs: [],
    holds,
    graph,
    branchedFromRunId: source.runId,
    branchedFromNode: anchor,
    versionNumber: versionNumber > 0 ? versionNumber : undefined,
    versions,
  })

  return streamChainRun({
    chain,
    workspace,
    runId,
    seedPrompt: source.seedPrompt,
    paramValue: source.parameter?.value ?? '',
    context: contextOverrides(context),
    replay,
    versionNumber,
    holds,
  })
}
