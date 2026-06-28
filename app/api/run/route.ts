import { NextRequest } from 'next/server'
import { loadWorkspace, getWorkspacePath } from '@/lib/fs/workspace'
import { initRunDir, writeAgentLog, updateRunMeta } from '@/lib/logger'
import { snapshotVersion } from '@/lib/fs/versions'
import { runChainGraph } from '@/lib/executor'
import { validateChain } from '@/lib/chainGraph'
import { RunMeta, AgentOutput, AgentDef, ChainDef } from '@/lib/types'
import { nanoid } from 'nanoid'
import path from 'path'

export async function POST(req: NextRequest) {
  const { chainName, agentName, seedPrompt, branchedFromRunId, branchedFromStep, branchOutputs, type, slug } =
    await req.json()

  const { agents, skills, chains } = loadWorkspace()

  let chain: ChainDef | null = null
  let runTitle = ''
  let currentVersion = 0

  if (chainName) {
    const found = chains.find(c => c.name === chainName) || chains.find(c => c.slug === chainName)
    if (!found) return new Response('Chain not found', { status: 404 })
    chain = found
    runTitle = found.name
    currentVersion = snapshotVersion('chain', found.slug, '')
  } else if (agentName) {
    const agent = agents.find(a => a.name === agentName) || agents.find(a => a.slug === agentName)
    if (!agent) return new Response('Agent not found', { status: 404 })
    // Synthesize a one-node chain: seed -> agent.input
    chain = {
      slug: agent.slug, name: agent.name, description: '', filePath: '',
      nodes: [
        { id: 'seed', kind: 'seed' },
        { id: agent.slug, kind: 'agent', agent: agent.slug },
      ],
      edges: [{ fromNode: 'seed', fromSocket: 'output', toNode: agent.slug, toSocket: 'input' }],
    }
    runTitle = agent.name
    currentVersion = snapshotVersion('agent', agent.slug, agent.systemPrompt)
  } else {
    return new Response('No chain or agent specified', { status: 400 })
  }

  const validation = validateChain(chain, agents)
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

      try {
        const results = await runChainGraph(
          theChain, agents, skills, seedPrompt, wp,
          {
            onStart: (nodeId, agent) => {
              const s = step++
              stepOf.set(nodeId, s)
              nameOf.set(nodeId, agent)
              send({ type: 'agent_start', agentName: agent, nodeId, step: s })
            },
            onToken: (nodeId, token, tokenType) => {
              send({ type: 'token', agentName: nameOf.get(nodeId), nodeId, token, tokenType, step: stepOf.get(nodeId) })
            },
            onDone: (nodeId, output) => {
              let s = stepOf.get(nodeId)
              if (s === undefined) { s = step++; stepOf.set(nodeId, s); nameOf.set(nodeId, output.agentName) }
              if (currentVersion > 0) output.versionNumber = currentVersion
              writeAgentLog(runId, s, output)
              send({ type: 'agent_done', agentName: output.agentName, nodeId, step: s, output })
            },
          },
          undefined,
          (branchOutputs as AgentOutput[]) ?? [],
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
