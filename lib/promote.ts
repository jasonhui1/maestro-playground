import { chatTarget, type ChatRefusal } from './nodeChat'
import { downstreamIds } from './partialRun'
import type { AgentOutput, RunMeta } from './types'

export type PromoteRefusal = ChatRefusal | 'bad-turn' | 'in-loop'

export interface Promotion {
  /** The run's records, in order, with the promoted reply flagged on its source. */
  flaggedOutputs: AgentOutput[]
  /** The source record as flagged, for rewriting its log. */
  source: AgentOutput
  /** The promoted reply as the node's new output. */
  revision: AgentOutput
  /** Records the rerun replays: everything but the node's descendants. */
  kept: AgentOutput[]
  /** An answered hold lies downstream: rerunning in place would ask it again, so this forks (#99). */
  forks: boolean
}

/**
 * Use this (#98): a proposer's reply becomes its output and its descendants rerun.
 * `turn` is the exchange number the log shows under `### Turn N`; the last by default.
 */
export function planPromotion(meta: RunMeta, nodeId: string, turn?: number): Promotion | { refused: PromoteRefusal; reason: string } {
  const target = chatTarget(meta, nodeId)
  if ('refused' in target) return target
  if (target.node.zone) {
    return { refused: 'in-loop', reason: `Node ${nodeId} is inside a loop; its rounds cannot be promoted` }
  }

  const conversation = target.record.conversation ?? []
  const replies = conversation.flatMap((m, i) => (m.role === 'assistant' ? [i] : []))
  if (!replies.length) return { refused: 'bad-turn', reason: `Node ${nodeId} has no reply to promote` }
  const n = turn ?? replies.length
  if (n < 1 || n > replies.length) {
    return { refused: 'bad-turn', reason: `turn must be from 1 to ${replies.length}` }
  }
  const at = replies[n - 1]
  const reply = conversation[at]

  const downstream = downstreamIds(target.graph, nodeId)
  const forks = (meta.holds ?? []).some(h => h.resolvedAt && downstream.has(h.nodeId))

  const { record } = target
  const source: AgentOutput = {
    ...record,
    conversation: conversation.map((m, i) => (i === at ? { ...m, promoted: true } : m)),
  }
  const revision: AgentOutput = {
    nodeId: record.nodeId, agentName: record.agentName, systemPrompt: record.systemPrompt, input: record.input,
    model: record.model, status: 'success',
    output: reply.content,
    priorTranscript: [
      ...(record.priorTranscript ?? []),
      { role: 'assistant', content: record.output, ...(record.thought ? { thought: record.thought } : {}) },
      ...conversation.slice(0, at),
    ],
    ...(reply.thought ? { thought: reply.thought } : {}),
    tokensIn: 0, tokensOut: 0, costUsd: 0, latencyMs: 0,
    timestamp: new Date().toISOString(),
  }
  const flaggedOutputs = meta.agentOutputs.map((o, i) => (i === target.index ? source : o))
  const kept = flaggedOutputs.filter(o => !o.nodeId || !downstream.has(o.nodeId))
  return { flaggedOutputs, source, revision, kept, forks }
}
