import { RunEvent } from './runStream'
import { AgentOutput, ToolCallRecord } from './types'
import { groupToolCallsByTurn, ToolTurnGroup } from './tools/logFormat'
import { sameSectionWarning } from './sectionWarning'
import type { SectionWarning } from './sectionWarning'

// A ToolCallRecord before it finishes: `result`/`latencyMs` stay empty until
// tool_result lands, so the live list feeds groupToolCallsByTurn unchanged.
export interface LiveToolCall extends ToolCallRecord {
  status: 'running' | 'done'
  activity?: string
}

export interface NodeRunState {
  status: 'idle' | 'running' | 'success' | 'error' | 'skipped'
  output: string
  thought: string
  rounds: { round: number; output: string }[]
  agentName?: string
  result?: AgentOutput   // last agent_done payload; carries metrics/systemPrompt/error (#33)
  toolCalls: LiveToolCall[]
  pendingTurn?: number              // turn whose arguments are still composing
  turnText: Record<number, string>  // per-turn narration, kept out of `output`
  warnings: SectionWarning[]        // sections downstream edges asked this output for and did not find (#37)
}

export type RunStateMap = Record<string, NodeRunState>

export const emptyNodeState = (): NodeRunState =>
  ({ status: 'idle', output: '', thought: '', rounds: [], toolCalls: [], turnText: {}, warnings: [] })

// A finished transcript, as the live list holds it. Shared with the log-replay
// fold in ./runHistoryState.ts so the two cannot drift.
export const settledToolCalls = (calls: ToolCallRecord[]): LiveToolCall[] =>
  calls.map(c => ({ ...c, status: 'done' }))

// The live view and the log converge here by construction (#26, #35).
export function toolTurnsOf(state: NodeRunState): ToolTurnGroup<LiveToolCall>[] {
  return groupToolCallsByTurn(state.toolCalls)
}

const empty = emptyNodeState

export function applyRunEvent(state: RunStateMap, e: RunEvent): RunStateMap {
  if (e.type === 'agent_start') {
    const prev = state[e.nodeId] ?? empty()
    return { ...state, [e.nodeId]: { ...prev, status: 'running', output: '', thought: '', agentName: e.agentName, result: undefined, toolCalls: [], pendingTurn: undefined, turnText: {}, warnings: [] } }
  }
  if (e.type === 'token') {
    const prev = state[e.nodeId] ?? empty()
    if (e.tokenType === 'thought') return { ...state, [e.nodeId]: { ...prev, thought: prev.thought + e.token } }
    // A turn's tokens are its narration, not the node's answer — routing them to
    // `output` would fill the pane with chatter agent_done then overwrites.
    const next = e.turn === undefined
      ? { ...prev, output: prev.output + e.token }
      : { ...prev, turnText: { ...prev.turnText, [e.turn]: (prev.turnText[e.turn] ?? '') + e.token } }
    return { ...state, [e.nodeId]: next }
  }
  if (e.type === 'tool_pending') {
    const prev = state[e.nodeId] ?? empty()
    return { ...state, [e.nodeId]: { ...prev, pendingTurn: e.turn } }
  }
  if (e.type === 'tool_call') {
    const prev = state[e.nodeId] ?? empty()
    const call: LiveToolCall = {
      turn: e.turn, name: e.name, args: e.args, result: '', latencyMs: 0,
      isError: false, status: 'running', ...(e.activity ? { activity: e.activity } : {}),
    }
    const pendingTurn = prev.pendingTurn === e.turn ? undefined : prev.pendingTurn
    return { ...state, [e.nodeId]: { ...prev, toolCalls: [...prev.toolCalls, call], pendingTurn } }
  }
  if (e.type === 'tool_result') {
    const prev = state[e.nodeId] ?? empty()
    // Oldest still-running call of this turn with this name: a turn can call the
    // same tool more than once, and the result carries no call id.
    const at = prev.toolCalls.findIndex(c => c.turn === e.turn && c.name === e.name && c.status === 'running')
    if (at === -1) return state
    const toolCalls = [...prev.toolCalls]
    toolCalls[at] = { ...toolCalls[at], result: e.result, latencyMs: e.latencyMs, isError: e.isError, status: 'done' }
    return { ...state, [e.nodeId]: { ...prev, toolCalls } }
  }
  if (e.type === 'section_missing') {
    const prev = state[e.nodeId] ?? empty()
    if (prev.warnings.some(x => sameSectionWarning(x, e.warning))) return state
    return { ...state, [e.nodeId]: { ...prev, warnings: [...prev.warnings, e.warning] } }
  }
  if (e.type === 'agent_done') {
    const prev = state[e.nodeId] ?? empty()
    const status = (e.output.status as NodeRunState['status']) ?? 'success'
    const rounds = e.output.round !== undefined
      ? [...prev.rounds, { round: e.output.round, output: e.output.output }]
      : prev.rounds
    // The settled transcript wins: it carries turnText the events never send.
    const toolCalls = e.output.toolCalls ? settledToolCalls(e.output.toolCalls) : prev.toolCalls
    // section_missing always lands after this node's agent_done (#37).
    const warnings = e.output.warnings ?? prev.warnings
    return { ...state, [e.nodeId]: { ...prev, status, output: e.output.output, agentName: e.output.agentName, rounds, result: e.output, toolCalls, pendingTurn: undefined, warnings } }
  }
  return state
}
