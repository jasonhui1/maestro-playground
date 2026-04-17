import { NextRequest } from 'next/server'
import { loadWorkspace, getWorkspacePath } from '@/lib/fs/workspace'
import { buildSystemPrompt, runAgent } from '@/lib/runner'
import { ChatMessage, RunMeta } from '@/lib/types'
import { initRunDir, writeAgentLog, updateRunMeta, readRunMeta } from '@/lib/logger'
import { nanoid } from 'nanoid'

export async function POST(req: NextRequest) {
  const { agentName, messages, runId: reqRunId } = await req.json()

  if (!agentName) return new Response('Agent name is required', { status: 400 })
  if (!messages || !Array.isArray(messages)) return new Response('Messages history is required', { status: 400 })

  const { agents, skills } = loadWorkspace()
  const agentDef = agents.find(a => a.name === agentName)
  if (!agentDef) return new Response('Agent not found', { status: 404 })

  const runId = reqRunId || `${new Date().toISOString().slice(0, 10)}-${nanoid(6)}`
  const isNewRun = !reqRunId

  if (isNewRun) {
    const meta: RunMeta = {
      runId,
      chainName: `Chat with ${agentName}`,
      seedPrompt: messages[0]?.content || '',
      startedAt: new Date().toISOString(),
      status: 'running',
      agentOutputs: [],
    }
    initRunDir(meta)
  }

  const encoder = new TextEncoder()
  const stream = new ReadableStream({
    async start(controller) {
      const send = (data: object) => {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`))
      }

      try {
        if (isNewRun) {
          send({ type: 'run_id', runId })
        }

        send({ type: 'agent_start', agentName })

        const wp = getWorkspacePath()
        const lastUserMessage = [...messages].reverse().find(m => m.role === 'user')?.content || ''
        
        const systemPrompt = await buildSystemPrompt(
          agentDef, skills, [], wp, lastUserMessage
        )

        let history: ChatMessage[] = [...messages]
        const systemMessageIndex = history.findIndex(m => m.role === 'system')
        
        if (systemMessageIndex !== -1) {
          history[systemMessageIndex] = { role: 'system', content: systemPrompt }
        } else {
          history.unshift({ role: 'system', content: systemPrompt })
        }

        const output = await runAgent(
          agentDef,
          systemPrompt,
          lastUserMessage,
          (token, tokenType) => send({ type: 'token', agentName, token, tokenType }),
          history
        )

        // Persist the turn
        const stepIdx = Math.floor((messages.length - 1) / 2)
        writeAgentLog(runId, stepIdx, output)

        // Update RunMeta
        const currentMeta = readRunMeta(runId)
        const updatedOutputs = [...currentMeta.agentOutputs]
        updatedOutputs[stepIdx] = output
        
        updateRunMeta(runId, {
          agentOutputs: updatedOutputs,
          status: 'complete',
          completedAt: new Date().toISOString()
        })

        send({ type: 'agent_done', agentName, output, runId })
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error)
        send({ type: 'error', error: errorMessage })
        
        try {
          updateRunMeta(runId, { status: 'error' })
        } catch (e) {
          // Ignore if meta doesn't exist yet
        }
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
