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
  onToken?: (token: string) => void,
): Promise<AgentOutput> {
  const start = Date.now()
  let output = ''
  let tokensIn = 0
  let tokensOut = 0

  try {
    const stream = await client.chat.completions.create({
      model: agent.model,
      max_tokens: 2048,
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
        output += content
        onToken?.(content)
      }
      if (chunk.usage) {
        tokensIn = chunk.usage.prompt_tokens
        tokensOut = chunk.usage.completion_tokens
      }
    }

    return {
      agentName: agent.name,
      input: userMessage,
      output,
      tokensIn,
      tokensOut,
      costUsd: calcCost(agent.model, tokensIn, tokensOut),
      latencyMs: Date.now() - start,
      model: agent.model,
      timestamp: new Date().toISOString(),
      status: 'success',
    }
  } catch (err: any) {
    return {
      agentName: agent.name,
      input: userMessage,
      output: '',
      tokensIn,
      tokensOut,
      costUsd: 0,
      latencyMs: Date.now() - start,
      model: agent.model,
      timestamp: new Date().toISOString(),
      status: 'error',
      error: err.message,
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
