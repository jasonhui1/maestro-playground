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
