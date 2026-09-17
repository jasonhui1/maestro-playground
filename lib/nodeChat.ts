import { agentSlugOf } from './nodeKinds'
import { latestStepOf, readRunMeta, updateRunMeta, writeAgentLog } from './logger'
import type { AgentOutput, ChainEdge, ChainNode, ChatMessage, RunMeta } from './types'

export type ChatRefusal = 'unknown-node' | 'not-a-proposer' | 'no-output'

export const CHAT_REFUSAL_STATUS: Record<ChatRefusal, number> = { 'unknown-node': 404, 'not-a-proposer': 400, 'no-output': 400 }

export type ChatTarget =
  | { index: number; record: AgentOutput; agentSlug: string; node: ChainNode; graph: { nodes: ChainNode[]; edges: ChainEdge[] } }
  | { refused: ChatRefusal; reason: string }

/** The record a node chat continues: the node's latest output, which must have succeeded (#97). */
export function chatTarget(meta: RunMeta, nodeId: string): ChatTarget {
  const graph = meta.graph
  const node = graph?.nodes.find(n => n.id === nodeId)
  if (!graph || !node) return { refused: 'unknown-node', reason: `Node ${nodeId} is not in this run` }
  const agentSlug = agentSlugOf(node)
  if (!agentSlug) return { refused: 'not-a-proposer', reason: `A ${node.kind} node has no transcript to continue` }
  // The latest record, not the latest success: it is the one the node's latest log shows.
  const index = meta.agentOutputs.findLastIndex(o => o.nodeId === nodeId)
  if (index === -1 || meta.agentOutputs[index].status !== 'success') {
    return { refused: 'no-output', reason: `Node ${nodeId} has no output in this run` }
  }
  return { index, record: meta.agentOutputs[index], agentSlug, node, graph }
}

// Tool turns are dropped and thought never replayed (#92).
export function chatTranscript(record: AgentOutput, message: string): ChatMessage[] {
  const turns = [
    ...(record.priorTranscript ?? []),
    { role: 'assistant' as const, content: record.output },
    ...(record.conversation ?? []),
  ]
  return [
    { role: 'system', content: record.systemPrompt },
    { role: 'user', content: record.input },
    ...turns.map(({ role, content }) => ({ role, content })),
    { role: 'user', content: message },
  ]
}

/** Appends one exchange to the node's record in meta.json and rewrites its log. */
export function appendTurn(runId: string, nodeId: string, message: string, reply: ChatMessage): void {
  // Re-read: another turn may have landed while this one streamed.
  const meta = readRunMeta(runId)
  const target = chatTarget(meta, nodeId)
  const step = latestStepOf(runId, nodeId)
  if ('refused' in target) throw new Error(target.reason)
  if (step === undefined) throw new Error(`Node ${nodeId} has no log in this run`)
  const record: AgentOutput = {
    ...target.record,
    conversation: [...(target.record.conversation ?? []), { role: 'user', content: message }, reply],
  }
  updateRunMeta(runId, { agentOutputs: meta.agentOutputs.map((o, i) => (i === target.index ? record : o)) })
  writeAgentLog(runId, step, record)
}

const recordKey = (o: AgentOutput) => `${o.nodeId}|${o.round ?? ''}|${o.timestamp}`

/** A stretch's outputs, keeping turns a chat wrote to meta.json while it ran. */
export function keepConversations(results: AgentOutput[], onDisk: AgentOutput[]): AgentOutput[] {
  const written = new Map(onDisk.filter(o => o.conversation?.length).map(o => [recordKey(o), o.conversation!]))
  return results.map(o => {
    const conversation = written.get(recordKey(o))
    return conversation && conversation.length > (o.conversation?.length ?? 0) ? { ...o, conversation } : o
  })
}
