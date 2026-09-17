import { initRunDir } from './logger'
import { downstreamIds } from './partialRun'
import { contextOverrides, loadContinuation, newRunId, refusalResponse, streamChainRun } from './runSession'
import type { AgentOutput, HoldRecord, RunMeta } from './types'

const recordKey = (o: AgentOutput) => (o.nodeId ? `${o.nodeId}|${o.round ?? ''}` : o)

/** A new run of the source's graph with `replacement` as the anchor's output (#99). */
export function forkRun(
  source: RunMeta,
  anchor: string,
  replacement: { output: AgentOutput; hold?: HoldRecord },
  context: unknown,
): Response {
  const continuation = loadContinuation(source)
  if ('error' in continuation) return refusalResponse(continuation)
  const graph = source.graph!
  const dropped = downstreamIds(graph, anchor).add(anchor)
  const kept = source.agentOutputs.filter(o => !o.nodeId || !dropped.has(o.nodeId))
  // Repeated records from an in-place promote collapse to the latest, so each node logs once.
  const latest = new Map(kept.map(o => [recordKey(o), o]))
  const replay = [...kept.filter(o => latest.get(recordKey(o)) === o), replacement.output]
  const holds = [
    // An open hold carries no answer to replay; the fork reaches it again.
    ...(source.holds ?? []).filter(h => h.resolvedAt && !dropped.has(h.nodeId)),
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
