import { newRunId } from './logger'
import type { LiveWorkspace, Workspace } from './runFolders'
import { stretchLog, type NewRun, type RunEdit, type StretchLog } from './stretchLog'
import { runChainGraph } from './executor'
import { runToolContext } from './tools/context'
import { buildLayoutModel, failLayoutModel } from './layoutModel'
import { mergeHolds } from './hold'
import { sseResponse } from './sse'
import type { RunEvent } from './runStream'
import { keepConversations } from './nodeChat'
import type { AgentOutput, ChainDef, HoldRecord } from './types'
import type { RunDefinitions } from './runDefinitions'
import { diceField, rollRunDice, type DicePins, type RunDice } from './dice'

/** A request's `context` override map, or none when it is not an object. */
export function contextOverrides(value: unknown): Record<string, string> {
  return value && typeof value === 'object' ? value as Record<string, string> : {}
}

export type { LiveWorkspace }

export interface RunSession {
  ws: Workspace
  /** Already opened. */
  log: StretchLog
  chain: ChainDef
  workspace: RunDefinitions
  seedPrompt: string
  inputs?: Record<string, string>
  dice?: RunDice
  paramValue: string
  context: Record<string, string>
  /** Outputs handed to the graph as done: `logged` are already on disk here, never logged again (ADR-0011); `fresh` are logged first. */
  replay: { logged: AgentOutput[]; fresh: AgentOutput[] }
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
  const { ws: { root }, log, chain } = s
  const { runId } = log
  const replay = [...s.replay.logged, ...s.replay.fresh]
  const onDisk = new Set(s.replay.logged)

  return sseResponse(async send => {
    send(runStartEvent(runId, s.dice))

    // Every hop re-sends the panels, so a view drawing mid-run reads the finished
    // run's projection rather than porting the rule (#76).
    const soFar: AgentOutput[] = [...replay]
    const sendLayout = () => send({ type: 'layout', model: buildLayoutModel(chain, soFar, s.dice) })
    sendLayout()

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
            const n = log.start(nodeId)
            nameOf.set(nodeId, agent)
            send({ type: 'agent_start', agentName: agent, nodeId, step: n, kind: kindById.get(nodeId) })
          },
          onToken: (nodeId, token, tokenType, turn) => {
            send({ type: 'token', agentName: nameOf.get(nodeId), nodeId, token, tokenType, step: log.stepOf(nodeId), kind: kindById.get(nodeId), turn })
          },
          onDone: (nodeId, output) => {
            if (onDisk.has(output)) return
            if (!nameOf.has(nodeId)) nameOf.set(nodeId, output.agentName)
            const n = log.stepFor(nodeId)
            log.write(n, output)
            loggedOf.set(nodeId, { step: n, output })
            send({ type: 'agent_done', agentName: output.agentName, nodeId, step: n, output, kind: kindById.get(nodeId) })
            soFar.push({ ...output, nodeId })
            sendLayout()
          },
          onToolEvent: (nodeId, event) => {
            send({ ...event, nodeId, step: log.stepOf(nodeId), kind: kindById.get(nodeId) })
          },
          onWarning: warning => {
            const nodeId = warning.fromNode
            send({ type: 'section_missing', nodeId, warning, step: log.stepOf(nodeId), kind: kindById.get(nodeId) })
            const logged = loggedOf.get(nodeId)
            if (logged) log.write(logged.step, logged.output)
          },
          onHold: hold => { reached.push(hold) },
        },
        {
          seedPrompt: s.seedPrompt, inputs: s.inputs, dice: s.dice, paramValue: s.paramValue, context: s.context, replay, modelOverride: s.modelOverride,
          toolContext: runToolContext(s.ws, runId),
        },
      )

      const stretch = s.history ? [...s.history, ...results.filter(o => !onDisk.has(o))] : results
      const agentOutputs = keepConversations(stretch, log.read().agentOutputs)
      if (reached.length > 0) {
        const holds = mergeHolds(s.holds ?? [], reached)
        log.close({ status: 'waiting', agentOutputs, holds })
        // Wave-mate holds pause together, so each is announced (#93).
        for (const { nodeId } of reached) {
          send({ type: 'run_waiting', runId, nodeId, hold: holds.findLast(h => h.nodeId === nodeId)! })
        }
      } else {
        log.close({ status: 'complete', completedAt: new Date().toISOString(), agentOutputs })
        send({ type: 'run_complete', runId })
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error)
      // The panels first, then the run-level event: a client draws the frame it is
      // sent rather than copying this message onto panels itself (#77).
      send({ type: 'layout', model: failLayoutModel(buildLayoutModel(chain, soFar, s.dice), errorMessage) })
      send({ type: 'error', error: errorMessage })
      log.close({ status: 'error' })
    }
  })
}

export function runStartEvent(runId: string, dice: RunDice | undefined): Extract<RunEvent, { type: 'run_start' }> {
  return { type: 'run_start', runId, ...diceField(dice) }
}

/** A new run folder for `chain`, streamed from step 0: a fresh run, or a fork replaying `replay` (#99). */
export interface StartRunInput extends NewRun {
  chain: ChainDef
  workspace: RunSession['workspace']
  /** Rolls a fork keeps; `startRun` rolls every other dice node. */
  dice?: RunDice
  dicePins?: DicePins
  /** A request's context overrides, laid over a fork's pinned context files. */
  context?: unknown
  pinnedContext?: Record<string, string>
  replay?: AgentOutput[]
  /** A fork's edit to its source, written once the fork's folder exists. */
  source?: RunEdit
}

export function startRun(ws: Workspace, run: StartRunInput): Response {
  const { chain, workspace, seedPrompt, parameter, versionNumber, holds } = run
  const dice = rollRunDice(chain, workspace, run.dice, run.dicePins)
  const log = stretchLog(ws.runs, { create: { runId: newRunId(), run: { ...run, dice } }, source: run.source }, versionNumber)
  log.open()
  return streamChainRun({
    ws, log, chain, workspace, seedPrompt, holds,
    inputs: run.inputs,
    dice,
    context: { ...run.pinnedContext, ...contextOverrides(run.context) },
    paramValue: parameter?.value ?? '',
    replay: { logged: [], fresh: run.replay ?? [] },
    modelOverride: run.modelOverride,
  })
}
