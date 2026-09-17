import { nanoid } from 'nanoid'
import { getWorkspacePath, loadWorkspace } from './fs/workspace'
import { validateChain } from './chainGraph'
import { chainForResume } from './resolveRunChain'
import { pinRunVersions, versionKey } from './runVersions'
import { writeAgentLog, updateRunMeta, readRunMeta } from './logger'
import { runChainGraph } from './executor'
import { buildLayoutModel, failLayoutModel } from './layoutModel'
import { mergeHolds } from './hold'
import { sseResponse } from './sse'
import { keepConversations } from './nodeChat'
import type { AgentDef, AgentOutput, ChainDef, HoldRecord, RunMeta, SkillDef, ToolDef } from './types'

/** A request's `context` override map, or none when it is not an object. */
export function contextOverrides(value: unknown): Record<string, string> {
  return value && typeof value === 'object' ? value as Record<string, string> : {}
}

/** A new run's folder name: its start date, then a short random suffix. */
export function newRunId(): string {
  return `${new Date().toISOString().slice(0, 10)}-${nanoid(6)}`
}

/** A run's recorded graph over live files, ready to continue or fork, with those files' pins; or why it cannot. */
export function loadContinuation(meta: RunMeta):
  | { chain: ChainDef; workspace: RunSession['workspace']; versionNumber: number; versions: Record<string, number> }
  | { error: string; status: number; errors?: unknown[] } {
  const workspace = loadWorkspace()
  const chain = chainForResume(meta, workspace.chains)
  if (!chain) return { error: 'Run has no recorded graph', status: 422 }
  const validation = validateChain(chain, workspace.agents, workspace.chains, workspace.tools, workspace.skills)
  if (!validation.valid) return { error: 'Invalid chain', status: 400, errors: validation.errors }
  // Live files run, as a branch does; the pins in meta stay what the run started with (ADR-0011).
  const versions = pinRunVersions(chain, workspace)
  return { chain, workspace, versionNumber: versions[versionKey('chain', chain.slug)] ?? 0, versions }
}

export interface RunSession {
  runId: string
  chain: ChainDef
  workspace: { agents: AgentDef[]; skills: SkillDef[]; chains: ChainDef[]; tools: ToolDef[] }
  seedPrompt: string
  paramValue: string
  context: Record<string, string>
  /** Outputs handed to the graph as already done; their out-edges are live. */
  replay: AgentOutput[]
  /** A resumed run: the leading `replay` records already logged, and the step the next log takes. */
  resumeFrom?: { logged: number; nextStep: number }
  /** Stamped on every newly logged record; 0 stamps nothing. */
  versionNumber: number
  /** Hold records the run carries before this stretch. */
  holds?: HoldRecord[]
  /** Every record the run holds before this stretch, including ones it reruns; the new records follow them in log order. */
  history?: AgentOutput[]
}

function afterHistory(results: AgentOutput[], history?: AgentOutput[]): AgentOutput[] {
  if (!history) return results
  const had = new Set(history)
  return [...history, ...results.filter(o => !had.has(o))]
}

/**
 * One stretch of a run — a fresh run, a branch, or a resume — executed and streamed
 * as SSE, ending with the run's meta.json written as complete, waiting or error.
 */
export function streamChainRun(s: RunSession): Response {
  const { runId, chain, workspace: { agents, skills, chains, tools } } = s
  const onDisk = new Set(s.replay.slice(0, s.resumeFrom?.logged ?? 0))

  return sseResponse(async send => {
    send({ type: 'run_start', runId })

    // Every hop re-sends the panels, so a view drawing mid-run reads the finished
    // run's projection rather than porting the rule (#76).
    const soFar: AgentOutput[] = [...s.replay]
    const sendLayout = () => send({ type: 'layout', model: buildLayoutModel(chain, soFar) })
    sendLayout()

    let step = s.resumeFrom?.nextStep ?? 0
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
        chain, agents, skills, s.seedPrompt, getWorkspacePath(),
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
            // A resumed run's earlier steps keep the log and version they were written with (ADR-0011).
            if (onDisk.has(output)) return
            let n = stepOf.get(nodeId)
            if (n === undefined) { n = step++; stepOf.set(nodeId, n); nameOf.set(nodeId, output.agentName) }
            if (s.versionNumber > 0) output.versionNumber = s.versionNumber
            writeAgentLog(runId, n, output)
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
            if (logged) writeAgentLog(runId, logged.step, logged.output)
          },
          onHold: hold => { reached.push(hold) },
        },
        undefined,
        s.replay,
        chains,
        tools,
        0,
        s.paramValue,
        s.context,
      )

      const agentOutputs = keepConversations(afterHistory(results, s.history), readRunMeta(runId).agentOutputs)
      if (reached.length > 0) {
        updateRunMeta(runId, { status: 'waiting', agentOutputs, holds: mergeHolds(s.holds ?? [], reached) })
        // Wave-mate holds pause together, so each is announced (#93).
        for (const hold of reached) send({ type: 'run_waiting', runId, nodeId: hold.nodeId, hold })
      } else {
        updateRunMeta(runId, { status: 'complete', completedAt: new Date().toISOString(), agentOutputs })
        send({ type: 'run_complete', runId })
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error)
      // The panels first, then the run-level event: a client draws the frame it is
      // sent rather than copying this message onto panels itself (#77).
      send({ type: 'layout', model: failLayoutModel(buildLayoutModel(chain, soFar), errorMessage) })
      send({ type: 'error', error: errorMessage })
      updateRunMeta(runId, { status: 'error' })
    }
  })
}
