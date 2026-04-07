import { NextRequest } from 'next/server'
import { loadWorkspace, getWorkspacePath } from '@/lib/fs/workspace'
import { buildSystemPrompt, runAgent } from '@/lib/runner'
import { initRunDir, writeAgentLog, updateRunMeta } from '@/lib/logger'
import { RunMeta } from '@/lib/types'
import { nanoid } from 'nanoid'

export async function POST(req: NextRequest) {
  const { chainName, seedPrompt, branchedFromRunId, branchedFromStep, branchOutputs } =
    await req.json()

  const { agents, skills, chains } = loadWorkspace()
  const chain = chains.find(c => c.name === chainName)
  if (!chain) return new Response('Chain not found', { status: 404 })

  const runId = `${new Date().toISOString().slice(0, 10)}-${nanoid(6)}`
  const meta: RunMeta = {
    runId,
    chainName,
    seedPrompt,
    startedAt: new Date().toISOString(),
    status: 'running',
    agentOutputs: [],
    branchedFromRunId,
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

      for (let i = startStep; i < chain.agents.length; i++) {
        const agentName = chain.agents[i]
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
          (token) => send({ type: 'token', agentName, token }),
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
      controller.close()
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
