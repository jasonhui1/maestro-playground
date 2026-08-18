import type { AgentOutput } from './types'
import type { RunStateMap, NodeRunState } from './runState'
import { emptyNodeState as empty, settledToolCalls, roundRecord } from './runState'

// The rail order a completed run implies: each node once, where it first ran. The live
// run gets this from runOrder events; a log has only the flat list to read it off.
export function runOrderOf(outputs: AgentOutput[]): string[] {
  const seen: string[] = []
  for (const o of outputs) {
    if (o.nodeId && !seen.includes(o.nodeId)) seen.push(o.nodeId)
  }
  return seen
}

// Where a node's round sits in the flat list, which is the step "branch from here" forks at.
// A null round is the panel's "latest" — the node's last step. -1 when there is no such step.
export function stepIndexOf(outputs: AgentOutput[], nodeId: string, round: number | null): number {
  if (round !== null) return outputs.findIndex(o => o.nodeId === nodeId && o.round === round)
  return outputs.findLastIndex(o => o.nodeId === nodeId)
}

// Fold a completed run's agentOutputs into the same RunStateMap the live editor run uses,
// keyed by nodeId. Mirrors lib/runState.applyRunEvent's agent_done case (accumulates rounds).
export function buildRunStateMap(outputs: AgentOutput[]): RunStateMap {
  const map: RunStateMap = {}
  for (const o of outputs) {
    if (!o.nodeId) continue
    const prev = map[o.nodeId] ?? empty()
    const rounds = o.round !== undefined
      ? [...prev.rounds, roundRecord(o.round, o)]
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
