import { chatTarget, type ChatRefusal } from './nodeChat'
import { downstreamIds } from './partialRun'
import type { AgentOutput, RunMeta } from './types'

export type PromoteRefusal = ChatRefusal | 'bad-turn' | 'in-loop' | 'past-answered-hold'

export interface Promotion {
  /** The run's records with the promoted turn flagged on its source, in their original order. */
  marked: AgentOutput[]
  /** The source record as flagged, for rewriting its log. */
  source: AgentOutput
  /** The promoted reply as the node's new output. */
  revision: AgentOutput
  /** Records the rerun replays: everything but the node's descendants. */
  kept: AgentOutput[]
  /** The descendants' records, which the rerun replaces. */
  superseded: AgentOutput[]
}

/**
 * Use this (#98): a proposer's reply becomes its output and its descendants rerun.
 * `turn` is the exchange number the log shows under `### Turn N`; the last by default.
 */
export function planPromotion(meta: RunMeta, nodeId: string, turn?: unknown): Promotion | { refused: PromoteRefusal; reason: string } {
  const target = chatTarget(meta, nodeId)
  if ('refused' in target) return target
  if (meta.graph!.nodes.find(n => n.id === nodeId)!.zone) {
    return { refused: 'in-loop', reason: `Node ${nodeId} is inside a loop; its rounds cannot be promoted` }
  }

  const conversation = target.record.conversation ?? []
  const replies = conversation.flatMap((m, i) => (m.role === 'assistant' ? [i] : []))
  const n = turn ?? replies.length
  if (!replies.length) return { refused: 'bad-turn', reason: `Node ${nodeId} has no reply to promote` }
  if (!Number.isInteger(n) || (n as number) < 1 || (n as number) > replies.length) {
    return { refused: 'bad-turn', reason: `turn must be a whole number from 1 to ${replies.length}` }
  }
  const at = replies[(n as number) - 1]
  const reply = conversation[at]

  const downstream = downstreamIds(meta.graph!, nodeId)
  // Rerunning an answered hold would ask the human again: that is a fork (#99).
  const answered = (meta.holds ?? []).find(h => h.resolvedAt && downstream.has(h.nodeId))
  if (answered) {
    return { refused: 'past-answered-hold', reason: `Hold ${answered.nodeId} is already answered; promoting past it forks the run (#99)` }
  }

  const source: AgentOutput = {
    ...target.record,
    conversation: conversation.map((m, i) => (i === at ? { ...m, promoted: true } : m)),
  }
  // The revision is only the reply: the source's transcript, warnings and version stay with the source.
  const revision: AgentOutput = {
    ...target.record,
    conversation: undefined, warnings: undefined, toolCalls: undefined, toolTurns: undefined, versionNumber: undefined,
    output: reply.content,
    thought: reply.thought,
    tokensIn: 0, tokensOut: 0, costUsd: 0, latencyMs: 0,
    timestamp: new Date().toISOString(),
  }
  const marked = meta.agentOutputs.map((o, i) => (i === target.index ? source : o))
  const isStale = (o: AgentOutput) => !!o.nodeId && downstream.has(o.nodeId)
  return { marked, source, revision, kept: marked.filter(o => !isStale(o)), superseded: marked.filter(isStale) }
}
