import { NextRequest } from 'next/server'
import { loadWorkspace, getWorkspacePath } from '@/lib/fs/workspace'
import { initRunDir, writeAgentLog, updateRunMeta } from '@/lib/logger'
import { snapshotVersion } from '@/lib/fs/versions'
import { runChainGraph } from '@/lib/executor'
import { validateChain } from '@/lib/chainGraph'
import { RunMeta, AgentOutput, AgentDef, ChainDef } from '@/lib/types'
import { resolveRunChain } from '@/lib/resolveRunChain'
import { nanoid } from 'nanoid'
import fs from 'fs'
import path from 'path'

export async function POST(req: NextRequest) {
  const body = await req.json()
  const { seedPrompt, branchedFromRunId, branchedFromStep, branchOutputs } = body

  const { agents, skills, chains, tools } = loadWorkspace()

  const resolved = resolveRunChain(body, { agents, chains })
  if ('error' in resolved) return new Response(resolved.error, { status: resolved.status })
  const { chain, title: runTitle, kind } = resolved

  let currentVersion = 0
  if (kind === 'chain' && chain.filePath) {
    let rawContent = ''
    try { rawContent = fs.readFileSync(chain.filePath, 'utf-8') } catch {}
    currentVersion = snapshotVersion('chain', chain.slug, rawContent)
  } else if (kind === 'agent') {
    const agent = agents.find(a => a.slug === chain.slug)
    if (agent) currentVersion = snapshotVersion('agent', agent.slug, agent.systemPrompt)
  }

  const validation = validateChain(chain, agents, chains, tools)
  if (!validation.valid) {
    return new Response(JSON.stringify({ error: 'Invalid chain', errors: validation.errors }), {
      status: 400, headers: { 'Content-Type': 'application/json' },
    })
  }

  const runId = `${new Date().toISOString().slice(0, 10)}-${nanoid(6)}`
  const meta: RunMeta = {
    runId,
    chainName: runTitle,
    seedPrompt,
    startedAt: new Date().toISOString(),
    status: 'running',
    agentOutputs: [],
    graph: { nodes: chain.nodes, edges: chain.edges },
    branchedFromRunId: branchedFromRunId ? path.basename(branchedFromRunId) : undefined,
    branchedFromStep,
    versionNumber: currentVersion > 0 ? currentVersion : undefined,
  }
  initRunDir(meta)

  const encoder = new TextEncoder()
  const wp = getWorkspacePath()
  const theChain = chain

  const stream = new ReadableStream({
    async start(controller) {
      const send = (data: object) => controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`))

      let step = 0
      const stepOf = new Map<string, number>()
      const nameOf = new Map<string, string>()
      // The graph is fixed, so kind is knowable here rather than threaded
      // through the executor's eleven emit sites (#35).
      const kindById = new Map(theChain.nodes.map(n => [n.id, n.kind]))

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
              send({ type: 'agent_done', agentName: output.agentName, nodeId, step: s, output, kind: kindById.get(nodeId) })
            },
            onToolEvent: (nodeId, event) => {
              send({ ...event, nodeId, step: stepOf.get(nodeId), kind: kindById.get(nodeId) })
            },
          },
          undefined,
          (branchOutputs as AgentOutput[]) ?? [],
          chains,
          tools,
        )

        updateRunMeta(runId, { status: 'complete', completedAt: new Date().toISOString(), agentOutputs: results })
        send({ type: 'run_complete', runId })
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error)
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
