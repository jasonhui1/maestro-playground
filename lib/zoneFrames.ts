import { ChainNode } from './types'

export const NODE_W = 240
export const NODE_H = 120
export const PAD = 32

export interface ZoneFrameBox {
  zone: string
  x: number
  y: number
  width: number
  height: number
}

export function computeZoneFrames(nodes: ChainNode[]): ZoneFrameBox[] {
  const byZone = new Map<string, ChainNode[]>()
  for (const n of nodes) {
    if (!n.zone || !n.pos) continue
    const arr = byZone.get(n.zone) ?? []
    arr.push(n)
    byZone.set(n.zone, arr)
  }
  const frames: ZoneFrameBox[] = []
  for (const [zone, members] of byZone) {
    const xs = members.map(m => m.pos![0])
    const ys = members.map(m => m.pos![1])
    const minX = Math.min(...xs)
    const minY = Math.min(...ys)
    const maxX = Math.max(...xs) + NODE_W
    const maxY = Math.max(...ys) + NODE_H
    frames.push({ zone, x: minX - PAD, y: minY - PAD, width: maxX - minX + 2 * PAD, height: maxY - minY + 2 * PAD })
  }
  return frames
}
