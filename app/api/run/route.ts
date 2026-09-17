import { NextRequest } from 'next/server'
import { loadWorkspace, getWorkspacePath } from '@/lib/fs/workspace'
import { initRunDir, writeAgentLog, updateRunMeta } from '@/lib/logger'
import { pinRunVersions, versionKey } from '@/lib/runVersions'
import { runChainGraph } from '@/lib/executor'
import { validateChain } from '@/lib/chainGraph'
import { RunMeta, AgentOutput, AgentDef, ChainDef, HoldRecord } from '@/lib/types'
import { resolveRunChain } from '@/lib/resolveRunChain'
import { buildLayoutModel, failLayoutModel } from '@/lib/layoutModel'
import { nanoid } from 'nanoid'
import path from 'path'

export async function POST(req: NextRequest) {
  const body = await req.json()
  const { seedPrompt, branchedFromRunId, branchedFromStep, branchOutputs, paramValue, context } = body

  const workspace = loadWorkspace()
  const { agents, skills, chains, tools } = workspace

  const resolved = resolveRunChain(body, { agents, chains })
  if ('error' in resolved) return new Response(resolved.error, { status: resolved.status })
  const { chain, title: runTitle, kind } = resolved

  const validation = validateChain(chain, agents, chains, tools, skills)
  if (!validation.valid) {
    return new Response(JSON.stringify({ error: 'Invalid chain', errors: validation.errors }), {
      status: 400, headers: { 'Content-Type': 'application/json' },
    })
  }

  const versions = pinRunVersions(chain, workspace)
  // The scalar still names the entry point — the chain for a chain run, the agent
  // for an agent run — so a step log keeps the one number it has always carried.
  const currentVersion = versions[kind === 'agent' ? versionKey('agent', chain.slug) : versionKey('chain', chain.slug)] ?? 0

  const runId = `${new Date().toISOString().slice(0, 10)}-${nanoid(6)}`
  const meta: RunMeta = {
    runId,
    chainName: runTitle,
    seedPrompt,
    parameter: chain.parameter && paramValue ? { name: chain.parameter.name, value: paramValue } : undefined,
    startedAt: new Date().toISOString(),
    status: 'running',
    agentOutputs: [],
    graph: { nodes: chain.nodes, edges: chain.edges },
    branchedFromRunId: branchedFromRunId ? path.basename(branchedFromRunId) : undefined,
    branchedFromStep,
    versionNumber: currentVersion > 0 ? currentVersion : undefined,
    versions,
  }
  initRunDir(meta)

  const encoder = new TextEncoder()
  const wp = getWorkspacePath()
  const theChain = chain

  const stream = new ReadableStream({
    async start(controller) {
      const send = (data: object) => controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`))

      send({ type: 'run_start', runId })

      // The panels a client draws, rebuilt from the outputs so far and sent on every
      // hop — a view drawing mid-run reads the same projection the finished run does,
      // rather than porting the rule (#76). Replayed branch outputs seed it: the
      // executor hands those straight to the graph without an onDone.
      const soFar: AgentOutput[] = [...((branchOutputs as AgentOutput[]) ?? [])]
      const sendLayout = () => send({ type: 'layout', model: buildLayoutModel(theChain, soFar) })
      sendLayout()

      let step = 0
      const stepOf = new Map<string, number>()
      const nameOf = new Map<string, string>()
      // A warning is found downstream, after its node's log is already on disk —
      // so the log is rewritten from the same record the executor amended (#37).
      const loggedOf = new Map<string, { step: number; output: AgentOutput }>()
      // The graph is fixed, so kind is knowable here rather than threaded
      // through the executor's eleven emit sites (#35).
      const kindById = new Map(theChain.nodes.map(n => [n.id, n.kind]))
      let hold: HoldRecord | undefined

      try {
        const results = await runChainGraph(
          theChain, agents, skills, seedPrompt, wp,
          {
            onStart: (nodeId, agent) => {
              const s = step++
              stepOf.set(nodeId, s)
              nameOf.set(nodeId, agent)
              send({ type: 'agent_start', agentName: agent, nodeId, step: s, kind: kindById.get(nodeId) })
            },
            onToken: (nodeId, token, tokenType, turn) => {
              send({ type: 'token', agentName: nameOf.get(nodeId), nodeId, token, tokenType, step: stepOf.get(nodeId), kind: kindById.get(nodeId), turn })
            },
            onDone: (nodeId, output) => {
              let s = stepOf.get(nodeId)
              if (s === undefined) { s = step++; stepOf.set(nodeId, s); nameOf.set(nodeId, output.agentName) }
              if (currentVersion > 0) output.versionNumber = currentVersion
              writeAgentLog(runId, s, output)
              loggedOf.set(nodeId, { step: s, output })
              send({ type: 'agent_done', agentName: output.agentName, nodeId, step: s, output, kind: kindById.get(nodeId) })
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
            onHold: (_nodeId, reached) => { hold = reached },
          },
          undefined,
          (branchOutputs as AgentOutput[]) ?? [],
          chains,
          tools,
          0,
          typeof paramValue === 'string' ? paramValue : '',
          context && typeof context === 'object' ? context : {},
        )

        if (hold) {
          const holds = [...(meta.holds ?? []), hold]
          updateRunMeta(runId, { status: 'waiting', agentOutputs: results, holds })
          send({ type: 'run_waiting', runId, nodeId: hold.nodeId, hold })
        } else {
          updateRunMeta(runId, { status: 'complete', completedAt: new Date().toISOString(), agentOutputs: results })
          send({ type: 'run_complete', runId })
        }
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error)
        // The panels first, then the run-level event: a client draws the frame it is
        // sent rather than copying this message onto panels itself (#77).
        send({ type: 'layout', model: failLayoutModel(buildLayoutModel(theChain, soFar), errorMessage) })
        send({ type: 'error', error: errorMessage })
        updateRunMeta(runId, { status: 'error' })
      } finally {
        controller.close()
      }
    },
  })

  return new Response(stream, {
    headers: { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' },
  })
}
