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
  // A rerun can repeat a round number (#90), so the latest write, not the first, is
  // the step "branch from here" should fork at.
  if (round !== null) return outputs.findLastIndex(o => o.nodeId === nodeId && o.round === round)
  return outputs.findLastIndex(o => o.nodeId === nodeId)
}

// Last write per node id, kept at first-appearance position (#90). No-nodeId
// records predate graph capture and can't be matched, so they're kept as-is.
export function latestOutputsByNode(outputs: AgentOutput[]): AgentOutput[] {
  const indexOfNode = new Map<string, number>()
  const result: AgentOutput[] = []
  for (const o of outputs) {
    if (!o.nodeId) { result.push(o); continue }
    const idx = indexOfNode.get(o.nodeId)
    if (idx === undefined) {
      indexOfNode.set(o.nodeId, result.length)
      result.push(o)
    } else {
      result[idx] = o
    }
  }
  return result
}

// Fold a completed run's agentOutputs into the same RunStateMap the live editor run uses,
// keyed by nodeId. Mirrors lib/runState.applyRunEvent's agent_done case (accumulates rounds).
export function buildRunStateMap(outputs: AgentOutput[]): RunStateMap {
  const map: RunStateMap = {}
  // A rerun (#90) resets `prev` to empty() instead of merging: only a strictly
  // increasing round continues the same loop attempt (ADR-0016 rule 4).
  const priorRound = new Map<string, number | undefined>()
  for (const o of outputs) {
    if (!o.nodeId) continue
    const continuesLoop = priorRound.has(o.nodeId)
      && o.round !== undefined
      && priorRound.get(o.nodeId) !== undefined
      && o.round > (priorRound.get(o.nodeId) as number)
    const prev = continuesLoop ? map[o.nodeId] : empty()
    priorRound.set(o.nodeId, o.round)
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
