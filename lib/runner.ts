import { AgentDef, AgentOutput, ChatMessage } from './types'
import { replaceTokens, proseRef } from './tokens'
import { calcCost, priceWarningFor } from './pricing'
import { injectSkills } from './prompt'
import { splitThought } from './modelStream'
import { createChatCall } from './chatCall'
import { runToolLoop, ToolLoopError, ChatCall, WireMessage } from './tools/loop'
import type { ToolEventSink, ToolNarration } from './tools/events'
import type { BoundTool } from './tools/registry'

export const DEFAULT_MAX_TOOL_TURNS = 8

export interface RunAgentOptions {
  onToken?: (token: string, type?: 'thought' | 'output', turn?: number) => void
  history?: ChatMessage[]
  boundTools?: BoundTool[]
  chatCall?: ChatCall   // test seam; production wires createChatCall(agent)
  onToolEvent?: ToolEventSink
}

// One body, tools or not: no tools is the same loop with an empty tool set,
// settling on its first turn (ADR-0002, #112).
export async function runAgent(
  agent: AgentDef,
  resolvedSystemPrompt: string,
  userMessage: string,
  options: RunAgentOptions = {},
): Promise<AgentOutput> {
  const { onToken, history, boundTools, chatCall, onToolEvent } = options
  const narrate: ToolNarration = { onEvent: onToolEvent, onToken }
  const start = Date.now()
  // Only role and content reach the wire: a stored turn's `thought` is ours, not
  // the provider's.
  const initial: WireMessage[] = history && history.length > 0
    ? history.map(m => ({ role: m.role, content: m.content }) as WireMessage)
    : [
        { role: 'system', content: resolvedSystemPrompt },
        { role: 'user', content: userMessage },
      ]
  const base = {
    agentName: agent.name,
    input: userMessage,
    systemPrompt: resolvedSystemPrompt,
    model: agent.model,
    modelSource: agent.resolution?.sources.model,
    timestamp: new Date().toISOString(),
  }

  try {
    const res = await runToolLoop(chatCall ?? createChatCall(agent), boundTools ?? [], initial, {
      maxToolTurns: agent.max_tool_turns ?? DEFAULT_MAX_TOOL_TURNS,
    }, narrate)
    const { output, thought } = splitThought(res.finalText)
    return {
      ...base,
      output,
      thought: thought || res.reasoning,
      tokensIn: res.tokensIn,
      tokensOut: res.tokensOut,
      costUsd: calcCost(agent.model, res.tokensIn, res.tokensOut),
      costWarning: priceWarningFor(agent.model),
      latencyMs: Date.now() - start,
      status: 'success',
      toolCalls: res.toolCalls,
      toolTurns: res.toolTurns,
    }
  } catch (err: unknown) {
    // A loop that died mid-flight still spent tokens and still did real work. Both
    // are reported: the transcript-so-far rides along so the log shows how far it
    // got, and cost reflects what was actually burned rather than a tidy zero.
    const partial = err instanceof ToolLoopError ? err : null
    const tokensIn = partial?.tokensIn ?? 0
    const tokensOut = partial?.tokensOut ?? 0
    return {
      ...base,
      output: '',
      tokensIn,
      tokensOut,
      costUsd: calcCost(agent.model, tokensIn, tokensOut),
      costWarning: priceWarningFor(agent.model),
      latencyMs: Date.now() - start,
      status: 'error',
      error: err instanceof Error ? err.message : String(err),
      ...(partial ? {
        toolCalls: partial.toolCalls,
        toolTurns: partial.toolCalls.reduce((max, c) => Math.max(max, c.turn), 0),
      } : {}),
    }
  }
}

/** A chat turn's system prompt: `{input}` is the user's message, any other slot a context file. */
export function buildSystemPrompt(
  agent: AgentDef,
  allSkills: import('./types').SkillDef[],
  userInput: string,
  readContext: (file: string) => string,
): string {
  const resolvedBody = replaceTokens(agent.systemPrompt, t => {
    const ref = proseRef(t)
    if (ref.kind === 'input') return userInput
    if (ref.kind === 'file') return readContext(ref.slug)
    return `[${ref.slug}.${ref.field}: not yet run]`
  })

  return injectSkills(agent, allSkills, resolvedBody)
}
