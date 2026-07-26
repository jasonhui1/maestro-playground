// lib/runModel.ts
import { applyRunEvent, RunStateMap, NodeRunState } from './runState'
import { RunEvent } from './runStream'

// 2D: instanceIndex -> nodeId -> NodeRunState (see design §7)
export type InstanceRunMap = Record<number, RunStateMap>

export function applyInstanceEvent(map: InstanceRunMap, instance: number, e: RunEvent): InstanceRunMap {
  const prev = map[instance] ?? {}
  return { ...map, [instance]: applyRunEvent(prev, e) }
}

export function nodeStateFor(map: InstanceRunMap, instance: number, nodeId: string): NodeRunState | undefined {
  return map[instance]?.[nodeId]
}

// RunStateMap is keyed by node id, so execution order is not recoverable from it.
// Views that render a sequence track it alongside the fold (#33).
export type InstanceOrder = Record<number, string[]>

export function applyInstanceOrder(order: InstanceOrder, instance: number, e: RunEvent): InstanceOrder {
  if (e.type !== 'agent_start' && e.type !== 'agent_done') return order
  // loop-end reports an empty record purely to mark the zone done; it has nothing to show (#33)
  if (e.kind === 'loop-end') return order
  const prev = order[instance] ?? []
  if (prev.includes(e.nodeId)) return order
  return { ...order, [instance]: [...prev, e.nodeId] }
}

export function orderFor(order: InstanceOrder, instance: number): string[] {
  return order[instance] ?? []
}
