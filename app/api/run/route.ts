import { NextRequest } from 'next/server'
import path from 'path'
import { loadWorkspace, getWorkspacePath } from '@/lib/fs/workspace'
import { buildSystemPrompt, runAgent } from '@/lib/runner'
import { initRunDir, writeAgentLog, updateRunMeta } from '@/lib/logger'
import { RunMeta, AgentOutput } from '@/lib/types'
import { nanoid } from 'nanoid'

export async function POST(req: NextRequest) {
  const { chainName, agentName, seedPrompt, branchedFromRunId, branchedFromStep, branchOutputs } =
    await req.json()

  const { agents, skills, chains } = loadWorkspace()
  
  let chainAgents: string[] = []
  let runTitle = ''

  if (chainName) {
    const chain = chains.find(c => c.name === chainName)
    if (!chain) return new Response('Chain not found', { status: 404 })
    chainAgents = chain.agents
    runTitle = chain.name
  } else if (agentName) {
    chainAgents = [agentName]
    runTitle = agentName
  } else {
    return new Response('No chain or agent specified', { status: 400 })
  }

  const runId = `${new Date().toISOString().slice(0, 10)}-${nanoid(6)}`
  const meta: RunMeta = {
    runId,
    chainName: runTitle,
    seedPrompt,
    startedAt: new Date().toISOString(),
    status: 'running',
    agentOutputs: [],
    branchedFromRunId: branchedFromRunId ? path.basename(branchedFromRunId) : undefined,
    branchedFromStep,
  }
  initRunDir(meta)

  const encoder = new TextEncoder()
  const stream = new ReadableStream({
    async start(controller) {
      const send = (data: object) => {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`))
      }

      const previousOutputs = branchOutputs ?? []
      const wp = getWorkspacePath()
      const startStep = branchedFromStep ?? 0

      // Write branched outputs to the new run's log folder and send done events
      if (branchOutputs && branchOutputs.length > 0) {
        branchOutputs.forEach((output: AgentOutput, idx: number) => {
          writeAgentLog(runId, idx, output)
          send({ type: 'agent_done', agentName: output.agentName, step: idx, output })
        })
      }

      try {
        for (let i = startStep; i < chainAgents.length; i++) {
          const agentName = chainAgents[i]
          const agentDef = agents.find(a => a.name === agentName)
          if (!agentDef) {
            send({ type: 'error', agentName, error: `Agent "${agentName}" not found` })
            continue
          }

          send({ type: 'agent_start', agentName, step: i })

          const systemPrompt = await buildSystemPrompt(
            agentDef, skills, previousOutputs, wp, seedPrompt
          )

          // user message is {input} resolved — already in system prompt for most agents
          const userMessage = i === 0 ? seedPrompt : 'Continue based on your instructions.'

          const output = await runAgent(
            agentDef,
            systemPrompt,
            userMessage,
            (token) => send({ type: 'token', agentName, token, step: i }),
          )

          previousOutputs.push(output)
          writeAgentLog(runId, i, output)
          send({ type: 'agent_done', agentName, step: i, output })
        }

        updateRunMeta(runId, {
          status: 'complete',
          completedAt: new Date().toISOString(),
          agentOutputs: previousOutputs,
        })

        send({ type: 'run_complete', runId })
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error)
        send({ type: 'error', error: errorMessage })
        updateRunMeta(runId, {
          status: 'error',
          agentOutputs: previousOutputs,
        })
      } finally {
        controller.close()
      }
    },
  })

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    },
  })
}
