import { unprocessable } from './refusal'
import { validateChain } from './chainGraph'
import { chainForResume } from './resolveRunChain'
import { pinRunVersions } from './runVersions'
import { versionKey } from './runVersionModel'
import { pinnedWorkspace } from './pinnedWorkspace'
import { newRunId } from './logger'
import type { LiveWorkspace, Workspace } from './runFolders'
import { runChainGraph } from './executor'
import { buildLayoutModel, failLayoutModel } from './layoutModel'
import { mergeHolds } from './hold'
import { sseResponse } from './sse'
import { keepConversations } from './nodeChat'
import type { AgentOutput, ChainDef, HoldRecord, Refusal, RunMeta } from './types'
import type { RunDefinitions } from './runDefinitions'

/** A request's `context` override map, or none when it is not an object. */
export function contextOverrides(value: unknown): Record<string, string> {
  return value && typeof value === 'object' ? value as Record<string, string> : {}
}

/** Which files a continuation runs: the live ones, or the source run's pins (ADR-0011). */
export type ContinuationVersions = 'current' | 'pinned'

export type { LiveWorkspace }

/** A run's recorded graph over live or pinned files, ready to continue or fork, with those files' pins; or why it cannot. */
export function loadContinuation(root: string, live: LiveWorkspace, meta: RunMeta, from: ContinuationVersions = 'current'):
  | {
      chain: ChainDef
      workspace: RunSession['workspace']
      versionNumber: number
      versions: Record<string, number>
      /** Context files read back at their pins, for the executor's context overrides. */
      pinnedContext: Record<string, string>
    }
  | Refusal {
  if (from === 'pinned') {
    if (!meta.versions) return unprocessable('Run has no pinned versions')
    const pinned = pinnedWorkspace(root, live, meta.versions)
    if ('error' in pinned) return pinned
    const { context: pinnedContext, ...workspace } = pinned
    const chain = graphOver(meta, workspace)
    if ('error' in chain) return chain
    return { chain, workspace, versionNumber: meta.versionNumber ?? 0, versions: meta.versions, pinnedContext }
  }
  const chain = graphOver(meta, live)
  if ('error' in chain) return chain
  // Live files run by default; the pins in meta stay what the run started with (ADR-0011).
  const versions = pinRunVersions(root, chain, live)
  return { chain, workspace: live, versionNumber: versions[versionKey('chain', chain.slug)] ?? 0, versions, pinnedContext: {} }
}

function graphOver(meta: RunMeta, ws: RunSession['workspace']): ChainDef | Refusal {
  const chain = chainForResume(meta, ws.chains)
  if (!chain) return unprocessable('Run has no recorded graph')
  const validation = validateChain(chain, ws)
  if (!validation.valid) return { error: 'Invalid chain', status: 400, errors: validation.errors }
  return chain
}

export interface RunSession {
  ws: Workspace
  runId: string
  chain: ChainDef
  workspace: RunDefinitions
  seedPrompt: string
  paramValue: string
  context: Record<string, string>
  /** Outputs handed to the graph as done: `logged` are already on disk here, never logged again (ADR-0011); `fresh` are logged first. */
  replay: { logged: AgentOutput[]; fresh: AgentOutput[] }
  /** The step the first new log takes; 0 for a new run folder. */
  firstStep: number
  /** Stamped on every newly logged record; 0 stamps nothing. */
  versionNumber: number
  /** Hold records the run carries before this stretch. */
  holds?: HoldRecord[]
  /** Every record the run holds before this stretch, including ones it reruns; the new records follow it. */
  history?: AgentOutput[]
  /** Model override for this run (#128). */
  modelOverride?: string
}

/**
 * One stretch of a run — a fresh run, a fork, a resume or a promote — executed and streamed
 * as SSE, ending with the run's meta.json written as complete, waiting or error.
 */
export function streamChainRun(s: RunSession): Response {
  const { ws: { root, runs }, runId, chain } = s
  const replay = [...s.replay.logged, ...s.replay.fresh]
  const onDisk = new Set(s.replay.logged)

  return sseResponse(async send => {
    send({ type: 'run_start', runId })

    // Every hop re-sends the panels, so a view drawing mid-run reads the finished
    // run's projection rather than porting the rule (#76).
    const soFar: AgentOutput[] = [...replay]
    const sendLayout = () => send({ type: 'layout', model: buildLayoutModel(chain, soFar) })
    sendLayout()

    let step = s.firstStep
    const stepOf = new Map<string, number>()
    const nameOf = new Map<string, string>()
    // A warning is found downstream, after its node's log is already on disk —
    // so the log is rewritten from the same record the executor amended (#37).
    const loggedOf = new Map<string, { step: number; output: AgentOutput }>()
    // The graph is fixed, so kind is knowable here rather than threaded
    // through the executor's eleven emit sites (#35).
    const kindById = new Map(chain.nodes.map(n => [n.id, n.kind]))
    const reached: HoldRecord[] = []

    try {
      const results = await runChainGraph(
        chain, { ...s.workspace, root },
        {
          onStart: (nodeId, agent) => {
            const n = step++
            stepOf.set(nodeId, n)
            nameOf.set(nodeId, agent)
            send({ type: 'agent_start', agentName: agent, nodeId, step: n, kind: kindById.get(nodeId) })
          },
          onToken: (nodeId, token, tokenType, turn) => {
            send({ type: 'token', agentName: nameOf.get(nodeId), nodeId, token, tokenType, step: stepOf.get(nodeId), kind: kindById.get(nodeId), turn })
          },
          onDone: (nodeId, output) => {
            if (onDisk.has(output)) return
            let n = stepOf.get(nodeId)
            if (n === undefined) { n = step++; stepOf.set(nodeId, n); nameOf.set(nodeId, output.agentName) }
            if (s.versionNumber > 0) output.versionNumber = s.versionNumber
            runs.writeStep(runId, n, output)
            loggedOf.set(nodeId, { step: n, output })
            send({ type: 'agent_done', agentName: output.agentName, nodeId, step: n, output, kind: kindById.get(nodeId) })
            soFar.push({ ...output, nodeId })
            sendLayout()
          },
          onToolEvent: (nodeId, event) => {
            send({ ...event, nodeId, step: stepOf.get(nodeId), kind: kindById.get(nodeId) })
          },
          onWarning: warning => {
            const nodeId = warning.fromNode
            send({ type: 'section_missing', nodeId, warning, step: stepOf.get(nodeId), kind: kindById.get(nodeId) })
            const logged = loggedOf.get(nodeId)
            if (logged) runs.writeStep(runId, logged.step, logged.output)
          },
          onHold: hold => { reached.push(hold) },
        },
        { seedPrompt: s.seedPrompt, paramValue: s.paramValue, context: s.context, replay, modelOverride: s.modelOverride },
      )

      const stretch = s.history ? [...s.history, ...results.filter(o => !onDisk.has(o))] : results
      const agentOutputs = keepConversations(stretch, runs.read(runId).agentOutputs)
      if (reached.length > 0) {
        const holds = mergeHolds(s.holds ?? [], reached)
        runs.update(runId, { status: 'waiting', agentOutputs, holds })
        // Wave-mate holds pause together, so each is announced (#93).
        for (const { nodeId } of reached) {
          send({ type: 'run_waiting', runId, nodeId, hold: holds.findLast(h => h.nodeId === nodeId)! })
        }
      } else {
        runs.update(runId, { status: 'complete', completedAt: new Date().toISOString(), agentOutputs })
        send({ type: 'run_complete', runId })
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error)
      // The panels first, then the run-level event: a client draws the frame it is
      // sent rather than copying this message onto panels itself (#77).
      send({ type: 'layout', model: failLayoutModel(buildLayoutModel(chain, soFar), errorMessage) })
      send({ type: 'error', error: errorMessage })
      runs.update(runId, { status: 'error' })
    }
  })
}

/** A new run folder for `chain`, streamed from step 0: a fresh run, or a fork replaying `replay` (#99). */
export interface StartRunInput {
  chain: ChainDef
  workspace: RunSession['workspace']
  title: string
  seedPrompt: string
  parameter?: RunMeta['parameter']
  /** A request's context overrides, laid over a fork's pinned context files. */
  context?: unknown
  pinnedContext?: Record<string, string>
  versions: Record<string, number>
  /** The entry point's version, stamped on every log; 0 stamps nothing. */
  versionNumber: number
  replay?: AgentOutput[]
  holds?: HoldRecord[]
  forkedFrom?: { runId: string; nodeId: string }
  forkAnchors?: string[]
  replayedNodeIds?: string[]
  replayedSlots?: string[]
  sourceOutputs?: AgentOutput[]
  modelOverride?: string
  chainSlug?: string
  entrypoint?: { kind: 'chain' | 'agent' | 'inline'; slug?: string }
  variance?: RunMeta['variance']
}

export function startRun(ws: Workspace, run: StartRunInput): Response {
  const { chain, workspace, seedPrompt, parameter, versionNumber, holds } = run
  const runId = newRunId()
  ws.runs.create(newRunMeta(runId, run))
  return streamChainRun({
    ws, runId, chain, workspace, seedPrompt, versionNumber, holds,
    context: { ...run.pinnedContext, ...contextOverrides(run.context) },
    paramValue: parameter?.value ?? '',
    replay: { logged: [], fresh: run.replay ?? [] },
    firstStep: 0,
    modelOverride: run.modelOverride,
  })
}

/** The meta.json a new run folder starts with, running and with nothing logged yet. */
export function newRunMeta(runId: string, run: StartRunInput): RunMeta {
  const { chain, seedPrompt, parameter, versionNumber, holds } = run
  return {
    runId,
    chainName: run.title,
    seedPrompt,
    parameter,
    startedAt: new Date().toISOString(),
    status: 'running',
    agentOutputs: [],
    ...(holds ? { holds } : {}),
    graph: { nodes: chain.nodes, edges: chain.edges },
    ...(run.forkedFrom ? { branchedFromRunId: run.forkedFrom.runId, branchedFromNode: run.forkedFrom.nodeId } : {}),
    ...(run.forkAnchors ? { forkAnchors: run.forkAnchors } : {}),
    ...(run.replayedNodeIds ? { replayedNodeIds: run.replayedNodeIds } : {}),
    ...(run.replayedSlots ? { replayedSlots: run.replayedSlots } : {}),
    ...(run.sourceOutputs ? { sourceOutputs: run.sourceOutputs } : {}),
    versionNumber: versionNumber > 0 ? versionNumber : undefined,
    versions: run.versions,
    ...(run.modelOverride ? { modelOverride: run.modelOverride } : {}),
    ...(run.chainSlug ? { chainSlug: run.chainSlug } : {}),
    ...(run.entrypoint ? { entrypoint: run.entrypoint } : {}),
    ...(run.variance ? { variance: run.variance } : {}),
  }
}
