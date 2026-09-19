import { agentSlugOf } from './nodeKinds'
import { badRequest, notFound, unprocessable } from './refusal'
import { recordKey } from './partialRun'
import { latestStepOf, readRunMeta, updateRunMeta, writeAgentLog } from './logger'
import type { AgentDef, AgentOutput, ChainEdge, ChainNode, ChatMessage, Refusal, RunMeta } from './types'

export interface ChatTarget {
  index: number
  record: AgentOutput
  agentSlug: string
  node: ChainNode
  graph: { nodes: ChainNode[]; edges: ChainEdge[] }
}

/** A chat body's shape, the message trimmed. */
export function readChatRequest({ message }: Record<string, unknown>): { message: string } | Refusal {
  const text = typeof message === 'string' ? message.trim() : ''
  return text ? { message: text } : badRequest('message is required')
}

/** The step of the node's latest log: the one a chat or promote rewrites. */
export function loggedStep(runId: string, nodeId: string): number | Refusal {
  return latestStepOf(runId, nodeId) ?? badRequest(`Node ${nodeId} has no log in this run`)
}

/** The record a node chat continues: the node's latest output, which must have succeeded (#97). */
export function chatTarget(meta: RunMeta, nodeId: string): ChatTarget | Refusal {
  const graph = meta.graph
  const node = graph?.nodes.find(n => n.id === nodeId)
  if (!graph || !node) return notFound(`Node ${nodeId} is not in this run`)
  const agentSlug = agentSlugOf(node)
  if (!agentSlug) return badRequest(`A ${node.kind} node has no transcript to continue`)
  // The latest record, not the latest success: it is the one the node's latest log shows.
  const index = meta.agentOutputs.findLastIndex(o => o.nodeId === nodeId)
  if (index === -1 || meta.agentOutputs[index].status !== 'success') {
    return badRequest(`Node ${nodeId} has no output in this run`)
  }
  return { index, record: meta.agentOutputs[index], agentSlug, node, graph }
}

/** Who answers a node chat: its agent, as the model that wrote the output, not whatever the file names now. */
export function chatSpeaker(meta: RunMeta, nodeId: string, agents: AgentDef[]): { target: ChatTarget; agent: AgentDef } | Refusal {
  const target = chatTarget(meta, nodeId)
  if ('error' in target) return target
  const step = loggedStep(meta.runId, nodeId)
  if (typeof step !== 'number') return step
  const live = agents.find(a => a.slug === target.agentSlug)
  if (!live) return unprocessable(`Agent ${target.agentSlug} no longer exists`)
  return { target, agent: target.record.model ? { ...live, model: target.record.model } : live }
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
  const step = loggedStep(runId, nodeId)
  if ('error' in target) throw new Error(target.error)
  if (typeof step !== 'number') throw new Error(step.error)
  const record: AgentOutput = {
    ...target.record,
    conversation: [...(target.record.conversation ?? []), { role: 'user', content: message }, reply],
  }
  updateRunMeta(runId, { agentOutputs: meta.agentOutputs.map((o, i) => (i === target.index ? record : o)) })
  writeAgentLog(runId, step, record)
}

/** A stretch's outputs, keeping turns a chat wrote to meta.json while it ran. */
export function keepConversations(results: AgentOutput[], onDisk: AgentOutput[]): AgentOutput[] {
  // A slot can hold a superseded write too; the timestamp says which write this is.
  const sameWrite = (a: AgentOutput, b: AgentOutput) => recordKey(a) === recordKey(b) && a.timestamp === b.timestamp
  const written = onDisk.filter(o => o.conversation?.length)
  return results.map(o => {
    const conversation = written.findLast(w => sameWrite(w, o))?.conversation
    return conversation && conversation.length > (o.conversation?.length ?? 0) ? { ...o, conversation } : o
  })
}
