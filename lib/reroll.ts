import { checkRevision, readFeedback, readRevision, rerollHold, selectOpenHold, sliceCandidates, withFeedback } from './hold'
import { loadRunFor } from './loadRun'
import { agentSlugOf } from './nodeKinds'
import { buildLayoutModel } from './layoutModel'
import { badRequest, conflict, isRefusal, toResponse, unprocessable } from './refusal'
import { readSocket } from './resolveNode'
import { runAgent } from './runner'
import { withModelOverride } from './modelOverride'
import { bindAgentTools } from './tools/registry'
import { sseResponse } from './sse'
import { loadContinuation, type LiveWorkspace } from './runSession'
import type { Workspace } from './runFolders'
import type { AgentOutput, ChainEdge, ChainNode, HoldRecord, Refusal, RunMeta } from './types'

/** A reroll body, read: the hold, feedback to save first (omitted keeps it, `''` clears it), and the set it was asked from. */
export interface RerollRequest {
  holdId: string
  feedback?: string
  revision?: number
}

export function readRerollRequest(holdId: string, { feedback, revision }: Record<string, unknown>): RerollRequest | Refusal {
  const fb = readFeedback(feedback)
  if (isRefusal(fb)) return fb
  const rev = readRevision(revision)
  if (isRefusal(rev)) return rev
  return { holdId, ...(fb !== undefined ? { feedback: fb } : {}), ...(rev !== undefined ? { revision: rev } : {}) }
}

/** What a reroll reruns: the one agent-backed node on the hold's `in` socket, from its original prompt and input. */
export interface RerollPlan {
  producer: ChainNode
  edge: ChainEdge
  /** The producer's record that fed this hold, before any reroll augmented its prompt. */
  baseline: AgentOutput
}

/**
 * Reroll reruns one node and refreshes one hold, so it refuses any shape where that
 * would leave another reader of the producer's output holding the old one (#134).
 */
export function planReroll(meta: RunMeta, hold: HoldRecord): RerollPlan | Refusal {
  const graph = meta.graph
  if (!graph) return unprocessable('Run has no recorded graph')
  const inEdges = graph.edges.filter(e => e.toNode === hold.nodeId && e.toSocket === 'in')
  if (inEdges.length !== 1) return unprocessable(`Hold ${hold.nodeId} has no single producer on its in socket`)
  const [edge] = inEdges
  const producer = graph.nodes.find(n => n.id === edge.fromNode)
  if (!producer || (producer.kind !== 'agent' && producer.kind !== 'decider')) {
    return unprocessable(`Only an agent or decider wired straight into hold ${hold.nodeId} can be rerolled`)
  }
  if (producer.zone) return unprocessable(`${producer.id} is inside a loop; its rounds cannot be rerolled`)
  const others = graph.edges.filter(e => e.fromNode === producer.id && e !== edge).map(e => e.toNode)
  if (others.length) {
    return unprocessable(`${producer.id} also feeds ${[...new Set(others)].join(', ')}; rerolling it would leave them on its old output`)
  }
  const baseline = meta.agentOutputs.findLast(o => o.nodeId === producer.id && !o.reroll)
  if (!baseline || baseline.status !== 'success') return unprocessable(`${producer.id} has no output to reroll from`)
  return { producer, edge, baseline }
}

/** The producer's original system prompt plus the hold's feedback, rebuilt fresh for each attempt. */
export function rerollPrompt(systemPrompt: string, feedback: string | undefined): string {
  return feedback
    ? `${systemPrompt}\n\n---\nThe human asked for a fresh set of candidates. Their feedback:\n${feedback}`
    : systemPrompt
}

// Spend is summed over every record but a node reads as its last, so a failed attempt sits
// just before the record it failed to replace (#134).
function beforeLatest(outputs: AgentOutput[], nodeId: string, attempt: AgentOutput): AgentOutput[] {
  const at = outputs.findLastIndex(o => o.nodeId === nodeId)
  return [...outputs.slice(0, at), attempt, ...outputs.slice(at)]
}

const NO_CANDIDATES = 'Reroll produced no `## Candidate N` sections; the earlier candidates stay'

/** Fresh candidates from the producer feeding an open hold, streamed and ending in `run_waiting`.
 *  Request feedback is saved before generating; a failed attempt keeps it and the old set (#134). */
export function reroll(ws: Workspace, workspace: LiveWorkspace, meta: RunMeta, request: RerollRequest): Response | Refusal {
  const open = selectOpenHold(meta, request.holdId)
  if ('error' in open) return open
  const stale = checkRevision(open, request.revision, undefined)
  if (stale) return stale
  const plan = planReroll(meta, open)
  if ('error' in plan) return plan
  const { producer, edge, baseline } = plan
  const slug = agentSlugOf(producer)
  const agentDef = workspace.agents.find(a => a.slug === slug)
  if (!agentDef) return unprocessable(`Agent ${slug} is not in the workspace`)
  const continuation = loadContinuation(ws.root, workspace, meta)
  if ('error' in continuation) return continuation
  const { chain, versionNumber } = continuation

  const { record: hold, holds } = request.feedback === undefined
    ? { record: open, holds: meta.holds ?? [] }
    : withFeedback(meta.holds ?? [], open, request.feedback)
  if (!ws.runs.claim(meta.runId, { holds })) return conflict('Run is running')

  const { runs } = ws
  const { runId } = meta
  const agent = withModelOverride(agentDef, meta.modelOverride)
  const feedback = hold.feedback
  return sseResponse(async send => {
    send({ type: 'run_start', runId })
    send({ type: 'layout', model: buildLayoutModel(chain, meta.agentOutputs) })
    let next = hold
    try {
      const step = runs.nextStep(runId)
      send({ type: 'agent_start', agentName: agent.name, nodeId: producer.id, step, kind: producer.kind })
      const attempt = await runAgent(agent, rerollPrompt(baseline.systemPrompt, feedback), baseline.input, {
        onToken: (token, tokenType, turn) => send({ type: 'token', agentName: agent.name, nodeId: producer.id, token, tokenType, step, kind: producer.kind, turn }),
        boundTools: bindAgentTools(agent, workspace.tools, ws.root),
        onToolEvent: event => send({ ...event, nodeId: producer.id, step, kind: producer.kind }),
      })
      attempt.nodeId = producer.id
      attempt.reroll = { holdId: hold.nodeId, ...(feedback ? { feedback } : {}) }
      if (versionNumber > 0) attempt.versionNumber = versionNumber
      const input = readSocket(producer, edge.fromSocket, new Map([[producer.id, attempt]]), meta.seedPrompt, () => '').value
      if (attempt.status === 'success' && sliceCandidates(input).length === 0) {
        attempt.status = 'error'
        attempt.error = NO_CANDIDATES
      }
      runs.writeStep(runId, step, attempt)
      send({ type: 'agent_done', agentName: attempt.agentName, nodeId: producer.id, step, output: attempt, kind: producer.kind })

      const rerolled = attempt.status === 'success' ? rerollHold(holds, hold, input) : undefined
      const agentOutputs = rerolled ? [...runs.read(runId).agentOutputs, attempt] : beforeLatest(runs.read(runId).agentOutputs, producer.id, attempt)
      if (rerolled) next = rerolled.record
      runs.update(runId, { status: 'waiting', agentOutputs, holds: rerolled?.holds ?? holds })
      send({ type: 'layout', model: buildLayoutModel(chain, agentOutputs) })
      if (!rerolled) send({ type: 'reroll_failed', runId, nodeId: hold.nodeId, error: attempt.error ?? NO_CANDIDATES })
    } catch (error) {
      runs.update(runId, { status: 'waiting' })
      send({ type: 'reroll_failed', runId, nodeId: hold.nodeId, error: error instanceof Error ? error.message : String(error) })
    }
    send({ type: 'run_waiting', runId, nodeId: hold.nodeId, hold: next })
  })
}

/** Saves an open hold's reroll feedback without generating; `''` clears it (#134). */
export function saveFeedback(ws: Workspace, runId: string, holdId: string, body: Record<string, unknown>): Response {
  const feedback = readFeedback(body.feedback)
  if (feedback === undefined) return toResponse(badRequest('feedback is required; send "" to clear it'))
  if (isRefusal(feedback)) return toResponse(feedback)
  const meta = loadRunFor(ws.runs, runId, { mustNotBeRunning: true })
  if ('error' in meta) return toResponse(meta)
  const open = selectOpenHold(meta, holdId)
  if ('error' in open) return toResponse(open)
  const { record, holds } = withFeedback(meta.holds ?? [], open, feedback)
  ws.runs.update(runId, { holds })
  return Response.json({ hold: record })
}
