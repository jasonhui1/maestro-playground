import { RunEvent } from './runStream'
import { AgentOutput } from './types'

export interface NodeRunState {
  status: 'idle' | 'running' | 'success' | 'error' | 'skipped'
  output: string
  thought: string
  rounds: { round: number; output: string }[]
  agentName?: string
  result?: AgentOutput   // last agent_done payload; carries metrics/systemPrompt/error (#33)
}

export type RunStateMap = Record<string, NodeRunState>

const empty = (): NodeRunState => ({ status: 'idle', output: '', thought: '', rounds: [] })

export function applyRunEvent(state: RunStateMap, e: RunEvent): RunStateMap {
  if (e.type === 'agent_start') {
    const prev = state[e.nodeId] ?? empty()
    return { ...state, [e.nodeId]: { ...prev, status: 'running', output: '', thought: '', agentName: e.agentName, result: undefined } }
  }
  if (e.type === 'token') {
    const prev = state[e.nodeId] ?? empty()
    const next = e.tokenType === 'thought'
      ? { ...prev, thought: prev.thought + e.token }
      : { ...prev, output: prev.output + e.token }
    return { ...state, [e.nodeId]: next }
  }
  if (e.type === 'agent_done') {
    const prev = state[e.nodeId] ?? empty()
    const status = (e.output.status as NodeRunState['status']) ?? 'success'
    const rounds = e.output.round !== undefined
      ? [...prev.rounds, { round: e.output.round, output: e.output.output }]
      : prev.rounds
    return { ...state, [e.nodeId]: { ...prev, status, output: e.output.output, agentName: e.output.agentName, rounds, result: e.output } }
  }
  return state
}
