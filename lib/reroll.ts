import {
  checkRevision, findCandidate, readFeedback, readRevision, rerollHold, selectOpenHold, sliceCandidates, withFeedback,
} from './hold'
import { loadRunFor } from './loadRun'
import { agentSlugOf } from './nodeKinds'
import { buildLayoutModel } from './layoutModel'
import { badRequest, isRefusal, toResponse, unprocessable } from './refusal'
import { readSocket } from './resolveNode'
import { runAgent } from './runner'
import { bindAgentTools } from './tools/registry'
import { runToolContext } from './tools/context'
import { sseResponse, type SseSend } from './sse'
import { runStartEvent, type LiveWorkspace } from './runSession'
import type { StretchLog } from './stretchLog'
import type { Workspace } from './runFolders'
import type { AgentDef, AgentOutput, ChainDef, ChainEdge, ChainNode, HoldCandidate, HoldRecord, Refusal, RunMeta } from './types'

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

/** What a reroll settles before anything runs. */
export interface ReadyReroll extends RerollPlan {
  agent: AgentDef
  like?: HoldCandidate
}

/** The reroll `request` asks of `hold`, checked against the run and the workspace. */
export function readyReroll(workspace: LiveWorkspace, meta: RunMeta, hold: HoldRecord, request: RerollRequest): ReadyReroll | Refusal {
  const like = request.like === undefined ? undefined : findCandidate(hold, request.like)
  if (request.like !== undefined && !like) return badRequest(`like names no candidate of hold ${hold.nodeId}`)
  const stale = checkRevision(hold, request.revision, like && { candidate: like })
  if (stale) return stale
  const plan = planReroll(meta, hold)
  if ('error' in plan) return plan
  const slug = agentSlugOf(plan.producer)
  const agent = workspace.agents.find(a => a.slug === slug)
  if (!agent) return unprocessable(`Agent ${slug} is not in the workspace`)
  return { ...plan, agent, ...(like ? { like } : {}) }
}

/** A reroll ready to stream: where it writes, what reruns, and the hold it refreshes. */
export interface RerollStretch {
  ws: Workspace
  workspace: LiveWorkspace
  source: RunMeta
  chain: ChainDef
  /** Opened already, unless this is a fork. */
  log: StretchLog
  ready: ReadyReroll
  hold: HoldRecord
  holds: HoldRecord[]
  versionNumber: number
  /** A fork's new folder, opened only once a fresh set is in hand, with the records it starts with (#147). */
  fork?: { replay: AgentOutput[] }
}

const NO_CANDIDATES = 'Reroll produced no `## Candidate N` sections; the earlier candidates stay'

/** The producer feeding the hold reruns once, then the stretch waits at the hold again (#134). */
export function streamReroll(r: RerollStretch): Response {
  const { log, chain, hold, holds, fork } = r
  const { runId } = log
  const { dice } = r.source
  const replay = fork?.replay ?? []
  return sseResponse(async send => {
    send(runStartEvent(runId, dice))
    send({ type: 'layout', model: buildLayoutModel(chain, fork ? replay : r.source.agentOutputs, dice) })
    const logged = replay.flatMap(output => (output.nodeId ? [{ step: log.stepFor(output.nodeId), output }] : []))
    let opened = !fork
    let next = hold
    try {
      const step = log.start(r.ready.producer.id)
      const { attempt, input } = await attemptReroll(send, r, step)
      const rerolled = attempt.status === 'success' ? rerollHold(holds, hold, input) : undefined
      if (!opened) {
        if (!rerolled) {
          send({ type: 'reroll_failed', runId, nodeId: hold.nodeId, error: attempt.error ?? NO_CANDIDATES })
          return
        }
        opened = log.open()
        for (const { step: at, output } of logged) log.write(at, output)
      }
      log.write(step, attempt)

      const recorded = [...log.read().agentOutputs, ...replay]
      const agentOutputs = rerolled ? [...recorded, attempt] : beforeLatest(recorded, r.ready.producer.id, attempt)
      if (rerolled) next = rerolled.record
      log.close({ status: 'waiting', agentOutputs, holds: rerolled?.holds ?? holds })
      send({ type: 'layout', model: buildLayoutModel(chain, agentOutputs, dice) })
      if (!rerolled) send({ type: 'reroll_failed', runId, nodeId: hold.nodeId, error: attempt.error ?? NO_CANDIDATES })
    } catch (error) {
      // In place the run waits on its old set; a fork already on disk is marked failed, not left looking unfinished.
      if (!fork) log.close({ status: 'waiting' })
      else if (opened) log.close({ status: 'error' })
      send({ type: 'reroll_failed', runId, nodeId: hold.nodeId, error: error instanceof Error ? error.message : String(error) })
      if (fork) return
    }
    send({ type: 'run_waiting', runId, nodeId: hold.nodeId, hold: next })
  })
}

/** One streamed attempt of the producer at `step`; a success with no candidates is marked failed (#134). */
async function attemptReroll(
  send: SseSend, { ws, workspace, source, ready, hold, versionNumber }: RerollStretch, step: number,
): Promise<{ attempt: AgentOutput; input: string }> {
  const { producer, edge, baseline, agent } = ready
  const { feedback } = hold
  send({ type: 'agent_start', agentName: agent.name, nodeId: producer.id, step, kind: producer.kind })
  const attempt = await runAgent(agent, rerollPrompt(baseline.systemPrompt, feedback, hold.like?.candidate), baseline.input, {
    onToken: (token, tokenType, turn) => send({ type: 'token', agentName: agent.name, nodeId: producer.id, token, tokenType, step, kind: producer.kind, turn }),
    // A fork's folder is not written until its set is in hand, so images land in the source run.
    boundTools: bindAgentTools(agent, workspace.tools, { ...runToolContext(ws, source.runId), fixedParts: baseline.fixedParts }),
    onToolEvent: event => send({ ...event, nodeId: producer.id, step, kind: producer.kind }),
  })
  attempt.nodeId = producer.id
  if (baseline.fixedParts) attempt.fixedParts = baseline.fixedParts
  attempt.reroll = { holdId: hold.nodeId, ...(feedback ? { feedback } : {}) }
  if (versionNumber > 0) attempt.versionNumber = versionNumber
  const input = readSocket(producer, edge.fromSocket, new Map([[producer.id, attempt]]), source.seedPrompt, () => '').value
  if (attempt.status === 'success' && sliceCandidates(input).length === 0) {
    attempt.status = 'error'
    attempt.error = NO_CANDIDATES
  }
  send({ type: 'agent_done', agentName: attempt.agentName, nodeId: producer.id, step, output: attempt, kind: producer.kind })
  return { attempt, input }
}

// Spend is summed over every record but a node reads as its last, so a failed attempt sits
// just before the record it failed to replace (#134).
function beforeLatest(outputs: AgentOutput[], nodeId: string, attempt: AgentOutput): AgentOutput[] {
  const at = outputs.findLastIndex(o => o.nodeId === nodeId)
  return [...outputs.slice(0, at), attempt, ...outputs.slice(at)]
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
