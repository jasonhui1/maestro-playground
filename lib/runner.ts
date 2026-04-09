import OpenAI from 'openai'
import { AgentDef, AgentOutput } from './types'
import { resolveRefs } from './resolver'
import { calcCost } from './pricing'

const client = new OpenAI({
  baseURL: process.env.AI_BASE_URL || 'https://openrouter.ai/api/v1',
  apiKey: process.env.AI_API_KEY,
})

export async function runAgent(
  agent: AgentDef,
  resolvedSystemPrompt: string,
  userMessage: string,
  onToken?: (token: string, type?: 'thought' | 'output') => void,
): Promise<AgentOutput> {
  const start = Date.now()
  let output = ''
  let thought = ''
  let isThinking = false
  let tokensIn = 0
  let tokensOut = 0

  // Buffer to catch tags that are split across chunks
  let buffer = ''

  try {
    const stream = await client.chat.completions.create({
      model: agent.model,
      max_tokens: agent.max_tokens ?? 32768,
      messages: [
        { role: 'system', content: resolvedSystemPrompt },
        { role: 'user', content: userMessage }
      ],
      stream: true,
      stream_options: { include_usage: true },
    })

    for await (const chunk of stream) {
      const content = chunk.choices[0]?.delta?.content || ''
      if (content) {
        buffer += content

        let changed = true
        while (changed) {
          changed = false
          if (!isThinking) {
            const thoughtStart = buffer.indexOf('<thought>')
            if (thoughtStart !== -1) {
              const preThought = buffer.slice(0, thoughtStart)
              if (preThought) {
                output += preThought
                onToken?.(preThought, 'output')
              }
              isThinking = true
              buffer = buffer.slice(thoughtStart + '<thought>'.length)
              changed = true
            }
          } else {
            const thoughtEnd = buffer.indexOf('</thought>')
            if (thoughtEnd !== -1) {
              const preEnd = buffer.slice(0, thoughtEnd)
              if (preEnd) {
                thought += preEnd
                onToken?.(preEnd, 'thought')
              }
              isThinking = false
              buffer = buffer.slice(thoughtEnd + '</thought>'.length)
              changed = true
            }
          }
        }

        // Handle partial tags at the end of the buffer
        const currentTag = isThinking ? '</thought>' : '<thought>'
        let partialMatchIndex = -1
        
        for (let i = 1; i < currentTag.length; i++) {
          if (buffer.endsWith(currentTag.slice(0, i))) {
            partialMatchIndex = buffer.length - i
            break
          }
        }

        if (partialMatchIndex !== -1) {
          const readyText = buffer.slice(0, partialMatchIndex)
          if (readyText) {
            if (isThinking) {
              thought += readyText
              onToken?.(readyText, 'thought')
            } else {
              output += readyText
              onToken?.(readyText, 'output')
            }
          }
          buffer = buffer.slice(partialMatchIndex)
        } else {
          if (buffer.length > 0) {
            if (isThinking) {
              thought += buffer
              onToken?.(buffer, 'thought')
            } else {
              output += buffer
              onToken?.(buffer, 'output')
            }
            buffer = ''
          }
        }
      }
      if (chunk.usage) {
        tokensIn = chunk.usage.prompt_tokens
        tokensOut = chunk.usage.completion_tokens
      }
    }

    return {
      agentName: agent.name,
      input: userMessage,
      systemPrompt: resolvedSystemPrompt,
      output,
      thought,
      tokensIn,
      tokensOut,
      costUsd: calcCost(agent.model, tokensIn, tokensOut),
      latencyMs: Date.now() - start,
      model: agent.model,
      timestamp: new Date().toISOString(),
      status: 'success',
    }
  } catch (err: unknown) {
    const errorMessage = err instanceof Error ? err.message : String(err)
    return {
      agentName: agent.name,
      input: userMessage,
      systemPrompt: resolvedSystemPrompt,
      output: '',
      tokensIn,
      tokensOut,
      costUsd: 0,
      latencyMs: Date.now() - start,
      model: agent.model,
      timestamp: new Date().toISOString(),
      status: 'error',
      error: errorMessage,
    }
  }
}

export async function buildSystemPrompt(
  agent: AgentDef,
  allSkills: import('./types').SkillDef[],
  previousOutputs: AgentOutput[],
  workspacePath: string,
  userInput: string,
): Promise<string> {
  // 1. Inject always-on skills first
  const alwaysSkills = allSkills
    .filter(s => s.injected === 'always')
    .map(s => s.content)
    .join('\n\n---\n\n')

  // 2. Inject agent-declared skills
  const agentSkills = agent.skills
    .filter(name => name !== 'base-protocol') // already in always
    .map(name => allSkills.find(s => s.name === name)?.content ?? '')
    .filter(Boolean)
    .join('\n\n---\n\n')

  // 3. Resolve {} refs in the agent's system prompt body
  const resolvedBody = resolveRefs(
    agent.systemPrompt,
    previousOutputs,
    workspacePath,
    userInput,
  )

  return [alwaysSkills, agentSkills, resolvedBody].filter(Boolean).join('\n\n---\n\n')
}
