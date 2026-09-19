import { hasAnsweredHold } from './hold'
import { chatTarget } from './nodeChat'
import { runLog } from './partialRun'
import type { AgentOutput, Refusal, RunMeta } from './types'

/** A promote request, read: the node, and the `### Turn N` of its reply (the last by default). */
export interface PromoteRequest {
  nodeId: string
  turn?: number
}

/** A promote body's shape, before it meets a run. */
export function readPromoteRequest(nodeId: string, { turn }: Record<string, unknown>): PromoteRequest | Refusal {
  if (turn == null) return { nodeId }
  if (typeof turn !== 'number' || !Number.isInteger(turn)) return { error: 'turn must be a whole number', status: 400 }
  return { nodeId, turn }
}

export interface Promotion {
  /** The run's records, in order, with the promoted reply flagged on its source. */
  flaggedOutputs: AgentOutput[]
  /** The source record as flagged, for rewriting its log. */
  source: AgentOutput
  /** The promoted reply as the node's new output. */
  revision: AgentOutput
  /** An answered hold lies downstream: rerunning in place would ask it again, so this forks (#99). */
  forks: boolean
}

/**
 * Use this (#98): a proposer's reply becomes its output and its descendants rerun.
 * `turn` is the exchange number the log shows under `### Turn N`; the last by default.
 */
export function planPromotion(meta: RunMeta, nodeId: string, turn?: number): Promotion | Refusal {
  const target = chatTarget(meta, nodeId)
  if ('error' in target) return target
  if (target.node.zone) {
    return { error: `Node ${nodeId} is inside a loop; its rounds cannot be promoted`, status: 400 }
  }

  const conversation = target.record.conversation ?? []
  const replies = conversation.flatMap((m, i) => (m.role === 'assistant' ? [i] : []))
  if (!replies.length) return { error: `Node ${nodeId} has no reply to promote`, status: 400 }
  const n = turn ?? replies.length
  if (n < 1 || n > replies.length) {
    return { error: `turn must be from 1 to ${replies.length}`, status: 400 }
  }
  const at = replies[n - 1]
  const reply = conversation[at]

  const forks = hasAnsweredHold(meta.holds, runLog(meta).below(nodeId))

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
  return { flaggedOutputs, source, revision, forks }
}
