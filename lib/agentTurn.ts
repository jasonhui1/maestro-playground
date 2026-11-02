import type { AgentDef, AgentOutput, ChatMessage, ToolDef } from './types'
import { priceUsage } from './pricing'
import { splitThought } from './modelStream'
import { withModelOverride } from './modelOverride'
import type { ModelFactory } from './model'
import { runToolLoop, ToolLoopError, type WireMessage } from './tools/loop'
import type { ToolEventSink, ToolNarration } from './tools/events'
import { bindAgentTools } from './tools/registry'
import { attachImages, type ToolContext } from './tools/context'

export const DEFAULT_MAX_TOOL_TURNS = 8

/** One agent call, as every call site states it: a graph node, a reroll, a chat or a node chat (#170). */
export interface AgentTurn {
  agent: AgentDef
  systemPrompt: string
  input: string
  /** A transcript to continue, system turn first; without it the turn is `systemPrompt` then `input`. */
  history?: ChatMessage[]
  /** The run's model override (#128). */
  modelOverride?: string
  /** The workspace's tools, of which the agent binds those its file declares; the context's `fixedParts` is recorded on the output (#149). */
  tools?: { defs: ToolDef[]; context: ToolContext }
  onToken?: (token: string, type?: 'thought' | 'output', turn?: number) => void
  onToolEvent?: ToolEventSink
}

/** What the executor and the other call sites run a turn through. */
export type RunAgentTurn = (turn: AgentTurn) => Promise<AgentOutput>

/** `turn` on `model`: no tools is the same loop with an empty tool set, settling on its first turn (ADR-0002, #112). */
export async function runAgentTurn(model: ModelFactory, turn: AgentTurn): Promise<AgentOutput> {
  const { systemPrompt, input, history, tools, onToken, onToolEvent } = turn
  const agent = withModelOverride(turn.agent, turn.modelOverride)
  const narrate: ToolNarration = { onEvent: onToolEvent, onToken }
  const start = Date.now()
  // Only role and content reach the wire: a stored turn's `thought` is ours, not the provider's.
  const initial: WireMessage[] = history && history.length > 0
    ? history.map(m => ({ role: m.role, content: m.content }) as WireMessage)
    : [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: input },
      ]
  const parts = tools?.context.fixedParts
  const fixedParts = parts && Object.keys(parts).length > 0 ? parts : undefined
  const base = {
    agentName: agent.name,
    input,
    systemPrompt,
    model: agent.model,
    modelSource: agent.resolution?.sources.model,
    timestamp: new Date().toISOString(),
    ...(fixedParts ? { fixedParts } : {}),
  }
  const bound = tools ? bindAgentTools(agent, tools.defs, tools.context) : []

  try {
    const res = await runToolLoop(model(agent), bound, initial, {
      maxToolTurns: agent.max_tool_turns ?? DEFAULT_MAX_TOOL_TURNS,
    }, narrate)
    const { output, thought } = splitThought(res.finalText)
    return {
      ...base,
      output: attachImages(output, res.toolCalls),
      thought: thought || res.reasoning,
      tokensIn: res.tokensIn,
      tokensOut: res.tokensOut,
      ...priceUsage(agent.model, res.tokensIn, res.tokensOut),
      latencyMs: Date.now() - start,
      status: 'success',
      toolCalls: res.toolCalls,
      toolTurns: res.toolTurns,
    }
  } catch (err: unknown) {
    // A loop that died mid-flight still spent tokens and did real work: the transcript so far
    // rides along, and cost reflects what was burned rather than a tidy zero.
    const partial = err instanceof ToolLoopError ? err : null
    const tokensIn = partial?.tokensIn ?? 0
    const tokensOut = partial?.tokensOut ?? 0
    return {
      ...base,
      output: '',
      tokensIn,
      tokensOut,
      ...priceUsage(agent.model, tokensIn, tokensOut),
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
