import type { ChainDef, ChainNode, ChainNodeBase, ValidationIssue } from './types'
import { allKinds, kindOf, zoneStateName } from './nodeKinds'
import { topoSort } from './topoSort'

export const NODE_W = 240
export const NODE_H = 120
export const PAD = 32

type Graph = Pick<ChainDef, 'nodes' | 'edges'>

export interface ZoneState { name: string; accumulate: boolean; separator: string }

/** A `loop-start`/`loop-end` pair and what runs between them each round. */
export interface Zone {
  id: string
  startId: string
  endId: string
  /** Members that are not boundaries, in node order. */
  bodyIds: string[]
  /** `bodyIds` in dependency order; a body cycle drops its members. */
  bodyOrder: string[]
  states: ZoneState[]
  until: string
  maxIterations: number
}

export interface ZoneFrame { zone: string; x: number; y: number; width: number; height: number }

// A blank zone id is no zone: validation rejects it on a boundary, so nothing reads it as one.
function membersByZone(nodes: ChainNode[]): Map<string, ChainNode[]> {
  const byZone = new Map<string, ChainNode[]>()
  for (const n of nodes) {
    if (!n.zone?.trim()) continue
    byZone.set(n.zone, [...(byZone.get(n.zone) ?? []), n])
  }
  return byZone
}

// `?.`: the validator reaches here with kinds the registry does not know.
export const isBoundary = (node: ChainNode): boolean => kindOf(node.kind)?.zoneRole === 'boundary'

/** Distinct zone ids in node order. */
export function zoneNames(nodes: ChainNode[]): string[] {
  return [...membersByZone(nodes).keys()]
}

/** Zones that have both a `loop-start` and a `loop-end`; an unpaired one is left to `zoneIssues`. */
export function pairedZones(chain: Graph): Zone[] {
  const zones: Zone[] = []
  for (const [id, members] of membersByZone(chain.nodes)) {
    const start = members.find(n => n.kind === 'loop-start')
    const end = members.find(n => n.kind === 'loop-end')
    if (!start || !end) continue
    const bodyIds = members.filter(n => !isBoundary(n)).map(n => n.id)
    zones.push({
      id, startId: start.id, endId: end.id,
      bodyIds,
      bodyOrder: topoSort(bodyIds, chain.edges),
      states: (start.state ?? []).map(state => ({
        name: zoneStateName(state),
        accumulate: typeof state !== 'string' && state.accumulate === true,
        separator: typeof state !== 'string' ? (state.separator ?? '\n\n') : '\n\n',
      })),
      until: end.until || '',
      maxIterations: end.maxIterations || 1,
    })
  }
  return zones
}

const zoneBodyKinds = allKinds.filter(k => kindOf(k).zoneRole === 'body')

/** Every way the chain's zones are malformed; all are errors. */
export function zoneIssues(chain: Graph): Omit<ValidationIssue, 'severity'>[] {
  const issues: Omit<ValidationIssue, 'severity'>[] = []
  const add = (message: string, ref: Omit<ValidationIssue, 'message' | 'severity'> = {}) => issues.push({ message, ...ref })

  for (const n of chain.nodes) {
    if (isBoundary(n) && !n.zone?.trim()) add(`Node "${n.id}": ${n.kind} has no zone`, { nodeId: n.id })
    // A zone body runs only `body` kinds; any other would silently never run (#163).
    if (n.zone?.trim() && kindOf(n.kind)?.zoneRole === 'none') {
      add(`Node "${n.id}": a ${n.kind} cannot sit inside loop zone "${n.zone}" (a zone body runs only ${zoneBodyKinds.join(' and ')} nodes)`, { nodeId: n.id, zone: n.zone })
    }
  }

  for (const [zid, members] of membersByZone(chain.nodes)) {
    const starts = members.filter(n => n.kind === 'loop-start')
    const ends = members.filter(n => n.kind === 'loop-end')

    if (starts.length === 0) {
      if (ends.length > 0) {
        for (const end of ends) add(`Loop end "${end.id}" in zone "${zid}" is missing a paired loop-start`, { zone: zid, nodeId: end.id })
      } else {
        add(`Zone "${zid}": needs exactly one loop-start (found 0)`, { zone: zid })
      }
    } else if (starts.length > 1) {
      for (const start of starts) add(`Zone "${zid}": duplicate loop-start "${start.id}" (found ${starts.length})`, { zone: zid, nodeId: start.id })
    }

    if (ends.length === 0) {
      if (starts.length > 0) {
        for (const start of starts) add(`Loop start "${start.id}" in zone "${zid}" is missing a paired loop-end`, { zone: zid, nodeId: start.id })
      } else {
        add(`Zone "${zid}": needs exactly one loop-end (found 0)`, { zone: zid })
      }
    } else if (ends.length > 1) {
      for (const end of ends) add(`Zone "${zid}": duplicate loop-end "${end.id}" (found ${ends.length})`, { zone: zid, nodeId: end.id })
    }

    for (const end of ends) {
      if (!end.until || !end.until.trim()) add(`Zone "${zid}": loop-end needs an "until" condition`, { zone: zid, nodeId: end.id })
      if (!end.maxIterations || end.maxIterations < 1 || !Number.isInteger(end.maxIterations)) add(`Zone "${zid}": loop-end needs a positive integer maxIterations`, { zone: zid, nodeId: end.id })
    }
  }

  // Only a loop-start may be entered, and only a loop-end left, across a zone boundary.
  const byId = new Map(chain.nodes.map(n => [n.id, n]))
  for (const e of chain.edges) {
    const from = byId.get(e.fromNode), to = byId.get(e.toNode)
    if (from?.zone === to?.zone) continue
    if (to?.kind !== 'loop-start' && from?.kind !== 'loop-end') {
      add(`Edge "${e.fromNode}.${e.fromSocket}" -> "${e.toNode}.${e.toSocket}" crosses a zone boundary (only loop-start/loop-end may cross)`, { edge: e })
    }
  }
  return issues
}

/** One padded box per zone around its positioned members. */
export function zoneFrames(nodes: ChainNode[]): ZoneFrame[] {
  const frames: ZoneFrame[] = []
  for (const [zone, members] of membersByZone(nodes)) {
    const placed = members.filter(m => m.pos)
    if (placed.length === 0) continue
    const xs = placed.map(m => m.pos![0])
    const ys = placed.map(m => m.pos![1])
    const minX = Math.min(...xs), minY = Math.min(...ys)
    const maxX = Math.max(...xs) + NODE_W, maxY = Math.max(...ys) + NODE_H
    frames.push({ zone, x: minX - PAD, y: minY - PAD, width: maxX - minX + 2 * PAD, height: maxY - minY + 2 * PAD })
  }
  return frames
}

/**
 * The patch for dropping node `id` at `pos`: a body node joins the zone whose frame holds its
 * centre, or leaves its zone (`zone: undefined`) when none does. A boundary only moves — it
 * defines its zone, it cannot join another.
 */
export function adoptOnDrop(nodes: ChainNode[], id: string, pos: [number, number]): Pick<ChainNodeBase, 'pos' | 'zone'> {
  const node = nodes.find(n => n.id === id)
  if (!node || isBoundary(node)) return { pos }
  const [cx, cy] = [pos[0] + NODE_W / 2, pos[1] + NODE_H / 2]
  const frame = zoneFrames(nodes.filter(n => n.id !== id))
    .find(f => cx >= f.x && cx <= f.x + f.width && cy >= f.y && cy <= f.y + f.height)
  return { pos, zone: frame?.zone }
}

export function renameZone(nodes: ChainNode[], oldZone: string, newZone: string): ChainNode[] {
  if (!oldZone || oldZone === newZone) return nodes
  return nodes.map(n => (n.zone === oldZone ? { ...n, zone: newZone } : n))
}
