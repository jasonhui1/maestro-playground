import type { AgentOutput } from './types'
import type { RunStateMap, NodeRunState } from './runState'
import { emptyNodeState as empty, settledToolCalls } from './runState'

// Fold a completed run's agentOutputs into the same RunStateMap the live editor run uses,
// keyed by nodeId. Mirrors lib/runState.applyRunEvent's agent_done case (accumulates rounds).
export function buildRunStateMap(outputs: AgentOutput[]): RunStateMap {
  const map: RunStateMap = {}
  for (const o of outputs) {
    if (!o.nodeId) continue
    const prev = map[o.nodeId] ?? empty()
    const rounds = o.round !== undefined
      ? [...prev.rounds, { round: o.round, output: o.output }]
      : prev.rounds
    map[o.nodeId] = {
      ...prev,
      status: (o.status as NodeRunState['status']) || 'success',
      output: o.output,
      thought: o.thought ?? prev.thought,
      agentName: o.agentName,
      rounds,
      result: o,
      toolCalls: o.toolCalls ? settledToolCalls(o.toolCalls) : prev.toolCalls,
      warnings: o.warnings ?? prev.warnings,
    }
  }
  return map
}
