import { NextRequest } from 'next/server'
import { loadWorkspace, getWorkspacePath } from '@/lib/fs/workspace'
import { buildSystemPrompt, runAgent } from '@/lib/runner'
import { ChatMessage, RunMeta, AgentOutput } from '@/lib/types'
import { initRunDir, writeAgentLog, updateRunMeta, readRunMeta } from '@/lib/logger'
import { sseResponse } from '@/lib/sse'
import { newRunId } from '@/lib/runSession'

export async function POST(req: NextRequest) {
  try {
    const { agentName, messages: history, runId: existingRunId } = await req.json()

    if (!agentName) {
      return new Response('agentName is required', { status: 400 })
    }

    if (!history || !Array.isArray(history) || history.length === 0) {
      return new Response('messages array is required', { status: 400 })
    }

    const { agents, skills } = loadWorkspace()
    const agentDef = agents.find(a => a.name === agentName || a.slug === agentName)
    
    if (!agentDef) {
      return new Response(`Agent "${agentName}" not found`, { status: 404 })
    }

    const wp = getWorkspacePath()
    const lastUserMessage = history[history.length - 1].content

    // Handle Run Metadata
    let runId = existingRunId
    let meta: RunMeta
    let currentStep = 0

    if (runId) {
      try {
        meta = readRunMeta(runId)
        currentStep = meta.agentOutputs.length
      } catch (e) {
        // If runId not found, fallback to new
        runId = newRunId()
        meta = {
          runId,
          chainName: `Chat with ${agentDef.name}`,
          seedPrompt: history[0].content, // First message is the seed
          startedAt: new Date().toISOString(),
          status: 'running',
          agentOutputs: [],
        }
        initRunDir(meta)
      }
    } else {
      runId = newRunId()
      meta = {
        runId,
        chainName: `Chat with ${agentDef.name}`,
        seedPrompt: history[0].content,
        startedAt: new Date().toISOString(),
        status: 'running',
        agentOutputs: [],
      }
      initRunDir(meta)
    }

    const systemPrompt = await buildSystemPrompt(
      agentDef, 
      skills, 
      [], // For chat, we don't want history to resolve into {input}, we want history as messages
      wp, 
      lastUserMessage
    )

    // Prepend system prompt to the history for the LLM
    const fullHistory: ChatMessage[] = [
      { role: 'system', content: systemPrompt },
      ...history
    ]

    return sseResponse(async send => {
      // Send run_id early so frontend can update URL
      send({ type: 'run_id', runId })

      try {
        const result = await runAgent(
          agentDef,
          systemPrompt,
          lastUserMessage,
          {
            onToken: (token, tokenType) => send({ type: 'token', token, tokenType }),
            history: fullHistory,
          }
        )

        // Persist the output
        writeAgentLog(runId, currentStep, result)

        const updatedOutputs = [...meta.agentOutputs, result]
        updateRunMeta(runId, {
          agentOutputs: updatedOutputs,
          status: 'complete',
          completedAt: new Date().toISOString(),
        })

        send({ type: 'done', result, runId })
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error)
        send({ type: 'error', error: errorMessage })
        updateRunMeta(runId, { status: 'error' })
      }
    })
  } catch (error) {
    return new Response(error instanceof Error ? error.message : 'Internal Server Error', { status: 500 })
  }
}
