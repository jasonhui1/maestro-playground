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

// The order one instance's events leave behind. Identity is preserved when an event
// adds nothing, so a caller can hold it in state without re-rendering on every token.
export function applyOrder(order: string[], e: RunEvent): string[] {
  if (e.type !== 'agent_start' && e.type !== 'agent_done') return order
  // loop-end reports an empty record purely to mark the zone done; it has nothing to show (#33)
  if (e.kind === 'loop-end') return order
  if (order.includes(e.nodeId)) return order
  return [...order, e.nodeId]
}

export function applyInstanceOrder(order: InstanceOrder, instance: number, e: RunEvent): InstanceOrder {
  const prev = order[instance] ?? []
  const next = applyOrder(prev, e)
  return next === prev ? order : { ...order, [instance]: next }
}

export function orderFor(order: InstanceOrder, instance: number): string[] {
  return order[instance] ?? []
}
