import { badRequest, notFound, unprocessable, isRefusal } from './refusal'
import { isRecord, readRevision, reviseOutput, type Revision } from './revision'
import { parseModelOverride } from './modelOverride'
import type { ContinuationVersions } from './runSession'
import type { AgentOutput, Refusal, RunMeta } from './types'

/** A fork request read against its source run. */
export interface ForkPlan {
  /** The nodes whose output changes; each one's descendants rerun. The first names the fork. */
  anchors: string[]
  /** The anchors' new outputs; an anchor without one reruns too. */
  outputs: AgentOutput[]
  versions?: ContinuationVersions
  /** As requested: omitted inherits the source's, null clears it (#128). */
  modelOverride?: string | null
}

/** `POST /api/runs/:id/fork`'s body, read (capability `runFork`): rerun from `from`, and/or set `revisions` (node id → text or addressed edits). */
export interface ForkRequest {
  from?: string
  revisions?: Record<string, Revision>
  versions?: ContinuationVersions
  modelOverride?: string | null
}

/** A fork body's shape, before it meets a run. */
export function readForkRequest({ from, revisions, versions, modelOverride }: Record<string, unknown>): ForkRequest | Refusal {
  if (from !== undefined && typeof from !== 'string') return badRequest('from must be a node id')
  let parsedRevisions: Record<string, Revision> | undefined
  if (revisions !== undefined) {
    if (!isRecord(revisions)) return badRequest('revisions must map node ids to text or addressed edits')
    parsedRevisions = {}
    for (const [nodeId, value] of Object.entries(revisions)) {
      const rev = readRevision(value)
      if (isRefusal(rev)) return rev
      parsedRevisions[nodeId] = rev
    }
  }
  if (versions !== undefined && versions !== 'current' && versions !== 'pinned') {
    return badRequest("versions must be 'current' or 'pinned'")
  }
  const parsedOverride = parseModelOverride(modelOverride)
  if (!parsedOverride.valid) return badRequest(parsedOverride.error)
  if (from === undefined && !Object.keys(parsedRevisions ?? {}).length) return badRequest('from or revisions is required')
  if (from !== undefined && parsedRevisions && from in parsedRevisions) return badRequest(`Node ${from} cannot both rerun and be revised`)
  return {
    from,
    revisions: parsedRevisions,
    versions,
    ...(parsedOverride.value !== undefined ? { modelOverride: parsedOverride.value } : {}),
  }
}

/**
 * A fork request read against its source. Every anchor's descendants rerun,
 * bar a revised one: the human's text stands even below another anchor.
 */
export function planFork(source: RunMeta, { from, revisions, versions, modelOverride }: ForkRequest): ForkPlan | Refusal {
  const graph = source.graph
  if (!graph) return unprocessable('Run has no recorded graph')
  const revised = Object.entries(revisions ?? {})
  const anchors = [...(from === undefined ? [] : [from]), ...revised.map(([nodeId]) => nodeId)]
  for (const nodeId of anchors) {
    if (!graph.nodes.some(n => n.id === nodeId)) return notFound(`Node ${nodeId} is not in this run`)
  }

  const outputs: AgentOutput[] = []
  for (const [nodeId, rev] of revised) {
    const node = graph.nodes.find(n => n.id === nodeId)!
    if (node.kind === 'hold') return badRequest(`Node ${nodeId} is a hold; answer it through resume`)
    if (node.zone) return badRequest(`Node ${nodeId} is inside a loop; its rounds cannot be revised`)
    const record = source.agentOutputs.findLast(o => o.nodeId === nodeId)
    if (!record) return badRequest(`Node ${nodeId} has no output in this run`)
    const outcome = reviseOutput(record.output, rev)
    if (isRefusal(outcome)) return outcome
    outputs.push(revisedOutput(record, outcome.output))
  }
  return { anchors, outputs, versions, modelOverride }
}

// Nothing ran, so metrics are zero; the thought and chat argued for the old text.
function revisedOutput(record: AgentOutput, output: string): AgentOutput {
  const revised: AgentOutput = {
    ...record, output, status: 'success',
    tokensIn: 0, tokensOut: 0, costUsd: 0, latencyMs: 0, timestamp: new Date().toISOString(),
  }
  delete revised.thought
  delete revised.error
  delete revised.conversation
  return revised
}
