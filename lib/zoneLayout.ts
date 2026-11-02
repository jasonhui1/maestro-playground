import type { ChainNode, ChainNodeBase } from './types'
import { isBoundary, zoneMembers } from './zones'

export const NODE_W = 240
export const NODE_H = 120
export const PAD = 32

export interface ZoneFrame { id: string; x: number; y: number; width: number; height: number }

/** One padded box per zone around its positioned members. */
export function zoneFrames(nodes: ChainNode[]): ZoneFrame[] {
  const frames: ZoneFrame[] = []
  for (const [id, members] of zoneMembers(nodes)) {
    const placed = members.filter(m => m.pos)
    if (placed.length === 0) continue
    const xs = placed.map(m => m.pos![0])
    const ys = placed.map(m => m.pos![1])
    const minX = Math.min(...xs), minY = Math.min(...ys)
    const maxX = Math.max(...xs) + NODE_W, maxY = Math.max(...ys) + NODE_H
    frames.push({ id, x: minX - PAD, y: minY - PAD, width: maxX - minX + 2 * PAD, height: maxY - minY + 2 * PAD })
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
  return { pos, zone: frame?.id }
}
