import {
  checkRevision, findCandidate, readFeedback, readRevision, reopenHold, rerollHold, revisionOf, selectHold, selectOpenHold,
  sliceCandidates, withFeedback,
} from './hold'
import { forkStart } from './fork'
import { newRunId } from './logger'
import { loadRunFor } from './loadRun'
import { agentSlugOf } from './nodeKinds'
import { buildLayoutModel } from './layoutModel'
import { badRequest, conflict, isRefusal, toResponse, unprocessable } from './refusal'
import { readSocket } from './resolveNode'
import { runAgent } from './runner'
import { withModelOverride } from './modelOverride'
import { bindAgentTools } from './tools/registry'
import { sseResponse, type SseSend } from './sse'
import { loadContinuation, newRunMeta, type LiveWorkspace } from './runSession'
import type { Workspace } from './runFolders'
import type { AgentDef, AgentOutput, ChainEdge, ChainNode, HoldCandidate, HoldRecord, Refusal, RunMeta } from './types'

/** A reroll body, read: the hold, feedback to save first (omitted keeps it, `''` clears it), and the set it was asked from. */
export interface RerollRequest {
  holdId: string
  feedback?: string
  revision?: number
  /** Reroll in a new run and leave the source as it is; an answered hold always does (#147). */
  fork?: boolean
  /** A candidate heading of the hold's current set to ask for more like; it always forks (#147). */
  like?: string
}

export function readRerollRequest(holdId: string, { feedback, revision, fork, like }: Record<string, unknown>): RerollRequest | Refusal {
  const fb = readFeedback(feedback)
  if (isRefusal(fb)) return fb
  const rev = readRevision(revision)
  if (isRefusal(rev)) return rev
  if (fork != null && typeof fork !== 'boolean') return badRequest('fork must be a boolean')
  if (like != null && (typeof like !== 'string' || !like.trim())) return badRequest('like must be a candidate heading')
  if (like != null && fork === false) return badRequest('like always forks; drop fork: false')
  return {
    holdId,
    ...(fb !== undefined ? { feedback: fb } : {}),
    ...(rev !== undefined ? { revision: rev } : {}),
    ...(fork != null ? { fork } : {}),
    ...(like != null ? { like } : {}),
  }
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

/** The producer's original system prompt plus the hold's `like` candidate and feedback, rebuilt fresh for each attempt. */
export function rerollPrompt(systemPrompt: string, feedback: string | undefined, like?: HoldCandidate): string {
  const asks = [
    ...(like ? [`They want more like ${like.heading}:\n${like.body}`] : []),
    ...(feedback ? [`Their feedback:\n${feedback}`] : []),
  ]
  return asks.length
    ? `${systemPrompt}\n\n---\nThe human asked for a fresh set of candidates. ${asks.join('\n\n')}`
    : systemPrompt
}

// Spend is summed over every record but a node reads as its last, so a failed attempt sits
// just before the record it failed to replace (#134).
function beforeLatest(outputs: AgentOutput[], nodeId: string, attempt: AgentOutput): AgentOutput[] {
  const at = outputs.findLastIndex(o => o.nodeId === nodeId)
  return [...outputs.slice(0, at), attempt, ...outputs.slice(at)]
}

const NO_CANDIDATES = 'Reroll produced no `## Candidate N` sections; the earlier candidates stay'

/**
 * Fresh candidates from the producer feeding a hold, streamed. In place, an open hold of a
 * waiting run takes them (#134). A fork leaves the source as it is, so it may read a running
 * one, and a run exists only once its reroll succeeds (#147).
 */
export function reroll(ws: Workspace, workspace: LiveWorkspace, meta: RunMeta, request: RerollRequest): Response | Refusal {
  const hold = selectHold(meta, request.holdId)
  if ('error' in hold) return hold
  const forks = request.fork ?? (request.like !== undefined || hold.resolvedAt !== undefined)
  return forks ? rerollFork(ws, workspace, meta, hold, request) : rerollInPlace(ws, workspace, meta, request)
}

/** What either kind of reroll settles before anything runs. */
interface ReadyReroll extends RerollPlan {
  agent: AgentDef
  like?: HoldCandidate
}

function readyReroll(workspace: LiveWorkspace, meta: RunMeta, hold: HoldRecord, request: RerollRequest): ReadyReroll | Refusal {
  const stale = checkRevision(hold, request.revision, undefined)
  if (stale) return stale
  const like = request.like === undefined ? undefined : findCandidate(hold, request.like)
  if (request.like !== undefined && !like) return badRequest(`like names no candidate of hold ${hold.nodeId}`)
  const plan = planReroll(meta, hold)
  if ('error' in plan) return plan
  const slug = agentSlugOf(plan.producer)
  const agentDef = workspace.agents.find(a => a.slug === slug)
  if (!agentDef) return unprocessable(`Agent ${slug} is not in the workspace`)
  return { ...plan, agent: withModelOverride(agentDef, meta.modelOverride), ...(like ? { like } : {}) }
}

/** One streamed attempt of the producer at `step`; a success with no candidates is marked failed (#134). */
async function attemptReroll(
  send: SseSend, ws: Workspace, workspace: LiveWorkspace, seedPrompt: string,
  { producer, edge, baseline, agent }: ReadyReroll, hold: HoldRecord, step: number, versionNumber: number,
): Promise<{ attempt: AgentOutput; input: string }> {
  const { feedback } = hold
  send({ type: 'agent_start', agentName: agent.name, nodeId: producer.id, step, kind: producer.kind })
  const attempt = await runAgent(agent, rerollPrompt(baseline.systemPrompt, feedback, hold.like?.candidate), baseline.input, {
    onToken: (token, tokenType, turn) => send({ type: 'token', agentName: agent.name, nodeId: producer.id, token, tokenType, step, kind: producer.kind, turn }),
    boundTools: bindAgentTools(agent, workspace.tools, ws.root),
    onToolEvent: event => send({ ...event, nodeId: producer.id, step, kind: producer.kind }),
  })
  attempt.nodeId = producer.id
  attempt.reroll = { holdId: hold.nodeId, ...(feedback ? { feedback } : {}) }
  if (versionNumber > 0) attempt.versionNumber = versionNumber
  const input = readSocket(producer, edge.fromSocket, new Map([[producer.id, attempt]]), seedPrompt, () => '').value
  if (attempt.status === 'success' && sliceCandidates(input).length === 0) {
    attempt.status = 'error'
    attempt.error = NO_CANDIDATES
  }
  send({ type: 'agent_done', agentName: attempt.agentName, nodeId: producer.id, step, output: attempt, kind: producer.kind })
  return { attempt, input }
}

const messageOf = (error: unknown) => error instanceof Error ? error.message : String(error)

/** Request feedback is saved before generating; a failed attempt keeps it and the old set (#134). */
function rerollInPlace(ws: Workspace, workspace: LiveWorkspace, meta: RunMeta, request: RerollRequest): Response | Refusal {
  const open = selectOpenHold(meta, request.holdId)
  if ('error' in open) return open
  const plan = readyReroll(workspace, meta, open, request)
  if ('error' in plan) return plan
  const continuation = loadContinuation(ws.root, workspace, meta)
  if ('error' in continuation) return continuation
  const { chain, versionNumber } = continuation

  const { record: hold, holds } = request.feedback === undefined
    ? { record: open, holds: meta.holds ?? [] }
    : withFeedback(meta.holds ?? [], open, request.feedback)
  if (!ws.runs.claim(meta.runId, { holds })) return conflict('Run is running')

  const { runs } = ws
  const { runId } = meta
  return sseResponse(async send => {
    send({ type: 'run_start', runId })
    send({ type: 'layout', model: buildLayoutModel(chain, meta.agentOutputs) })
    let next = hold
    try {
      const step = runs.nextStep(runId)
      const { attempt, input } = await attemptReroll(send, ws, workspace, meta.seedPrompt, plan, hold, step, versionNumber)
      runs.writeStep(runId, step, attempt)

      const rerolled = attempt.status === 'success' ? rerollHold(holds, hold, input) : undefined
      const agentOutputs = rerolled ? [...runs.read(runId).agentOutputs, attempt] : beforeLatest(runs.read(runId).agentOutputs, plan.producer.id, attempt)
      if (rerolled) next = rerolled.record
      runs.update(runId, { status: 'waiting', agentOutputs, holds: rerolled?.holds ?? holds })
      send({ type: 'layout', model: buildLayoutModel(chain, agentOutputs) })
      if (!rerolled) send({ type: 'reroll_failed', runId, nodeId: hold.nodeId, error: attempt.error ?? NO_CANDIDATES })
    } catch (error) {
      runs.update(runId, { status: 'waiting' })
      send({ type: 'reroll_failed', runId, nodeId: hold.nodeId, error: messageOf(error) })
    }
    send({ type: 'run_waiting', runId, nodeId: hold.nodeId, hold: next })
  })
}

/**
 * A new run holding what `source` left above its hold, reopened on a fresh set. The folder is
 * written only once the set is in hand: a failed attempt ends in `reroll_failed` under a run id
 * that never lands on disk.
 */
function rerollFork(ws: Workspace, workspace: LiveWorkspace, meta: RunMeta, source: HoldRecord, request: RerollRequest): Response | Refusal {
  const plan = readyReroll(workspace, meta, source, request)
  if ('error' in plan) return plan
  const start = forkStart(ws, workspace, meta, { anchors: [source.nodeId], modelOverride: meta.modelOverride }, {})
  if ('error' in start) return start

  // The source's own rerolls answered its hold; this one starts again from the original record.
  const replay = (start.replay ?? []).map(o => (o.nodeId === plan.producer.id ? plan.baseline : o))
  const feedback = request.feedback ?? source.feedback
  const hold: HoldRecord = {
    ...reopenHold(source),
    ...(feedback ? { feedback } : {}),
    ...(plan.like ? { like: { candidate: plan.like, revision: revisionOf(source) } } : {}),
  }
  if (!feedback) delete hold.feedback
  if (!plan.like) delete hold.like

  const runId = newRunId()
  return sseResponse(async send => {
    send({ type: 'run_start', runId })
    send({ type: 'layout', model: buildLayoutModel(start.chain, replay) })
    try {
      const { attempt, input } = await attemptReroll(send, ws, workspace, meta.seedPrompt, plan, hold, replay.length, start.versionNumber)
      if (attempt.status !== 'success') {
        send({ type: 'reroll_failed', runId, nodeId: hold.nodeId, error: attempt.error ?? NO_CANDIDATES })
        return
      }
      const agentOutputs = [...replay, attempt]
      const rerolled = rerollHold([...start.holds ?? [], hold], hold, input)
      ws.runs.create({ ...newRunMeta(runId, start), status: 'waiting', agentOutputs, holds: rerolled.holds })
      agentOutputs.forEach((output, step) => ws.runs.writeStep(runId, step, output))
      send({ type: 'layout', model: buildLayoutModel(start.chain, agentOutputs) })
      send({ type: 'run_waiting', runId, nodeId: hold.nodeId, hold: rerolled.record })
    } catch (error) {
      send({ type: 'reroll_failed', runId, nodeId: hold.nodeId, error: messageOf(error) })
    }
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
