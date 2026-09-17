import { agentSlugOf } from './nodeKinds'
import type { AgentOutput, ChatMessage, RunMeta } from './types'

export type ChatTarget =
  | { index: number; record: AgentOutput; agentSlug: string }
  | { error: string; status: number }

/** The record a node chat continues: the node's latest successful output in the run (#97). */
export function chatTarget(meta: RunMeta, nodeId: string): ChatTarget {
  const node = meta.graph?.nodes.find(n => n.id === nodeId)
  if (!node) return { error: `Node ${nodeId} is not in this run`, status: 404 }
  const agentSlug = agentSlugOf(node)
  if (!agentSlug) return { error: `A ${node.kind} node has no transcript to continue`, status: 400 }
  const index = meta.agentOutputs.findLastIndex(o => o.nodeId === nodeId && o.status === 'success')
  if (index === -1) return { error: `Node ${nodeId} has no output in this run`, status: 400 }
  return { index, record: meta.agentOutputs[index], agentSlug }
}

// Tool turns are dropped and thought never replayed (#92).
export function chatTranscript(record: AgentOutput, message: string): ChatMessage[] {
  return [
    { role: 'system', content: record.systemPrompt },
    { role: 'user', content: record.input },
    { role: 'assistant', content: record.output },
    ...(record.conversation ?? []).map(({ role, content }) => ({ role, content })),
    { role: 'user', content: message },
  ]
}

export function withTurn(record: AgentOutput, message: string, reply: ChatMessage): AgentOutput {
  return {
    ...record,
    conversation: [...(record.conversation ?? []), { role: 'user', content: message }, reply],
  }
}
