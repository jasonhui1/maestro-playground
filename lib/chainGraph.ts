import { ChainDef, ChainNode, AgentDef, ValidationResult } from './types'
import { parseSlots } from './slots'
import { slugify } from './graph'

export function topoOrder(chain: ChainDef): string[] {
  const ids = chain.nodes.map(n => n.id)
  const indeg = new Map<string, number>(ids.map(id => [id, 0]))
  const adj = new Map<string, string[]>(ids.map(id => [id, []]))
  for (const e of chain.edges) {
    if (!indeg.has(e.toNode) || !adj.has(e.fromNode)) continue
    adj.get(e.fromNode)!.push(e.toNode)
    indeg.set(e.toNode, (indeg.get(e.toNode) || 0) + 1)
  }
  const queue = ids.filter(id => (indeg.get(id) || 0) === 0)
  const order: string[] = []
  while (queue.length) {
    const id = queue.shift()!
    order.push(id)
    for (const t of adj.get(id) || []) {
      indeg.set(t, (indeg.get(t) || 0) - 1)
      if ((indeg.get(t) || 0) === 0) queue.push(t)
    }
  }
  return order
}

export function validateChain(chain: ChainDef, agents: AgentDef[]): ValidationResult {
  const errors: string[] = []
  const seenIds = new Set<string>()
  for (const n of chain.nodes) {
    if (!n.id) {
      errors.push('Node is missing ID')
    } else if (seenIds.has(n.id)) {
      errors.push(`Duplicate node ID "${n.id}"`)
    }
    seenIds.add(n.id)
  }

  const nodeById = new Map(chain.nodes.map(n => [n.id, n]))
  const agentBySlug = new Map(agents.map(a => [a.slug, a]))

  const inputSlotsOf = (n: ChainNode): string[] => {
    if (n.kind !== 'agent') return []
    const a = n.agent ? agentBySlug.get(n.agent) : undefined
    return a ? parseSlots(a.systemPrompt) : []
  }
  const outputSocketsOf = (n: ChainNode): string[] => {
    if (n.kind !== 'agent') return ['output']
    const a = n.agent ? agentBySlug.get(n.agent) : undefined
    return ['output', ...(a?.outputs || []).map(s => slugify(s.name))]
  }

  const allowedKinds = new Set<string>(['seed', 'context', 'agent'])
  for (const n of chain.nodes) {
    if (!allowedKinds.has(n.kind)) {
      errors.push(`Node "${n.id}": invalid or missing kind "${n.kind}"`)
    }
    if (n.kind === 'agent' && (!n.agent || !agentBySlug.has(n.agent))) errors.push(`Node "${n.id}": agent "${n.agent ?? ''}" not found`)
    if (n.kind === 'context' && !n.file) errors.push(`Node "${n.id}": context node missing "file"`)
  }

  const incoming = new Map<string, number>()
  for (const e of chain.edges) {
    const src = nodeById.get(e.fromNode)
    const dst = nodeById.get(e.toNode)
    if (!src) { errors.push(`Edge from unknown node "${e.fromNode}"`); continue }
    if (!dst) { errors.push(`Edge to unknown node "${e.toNode}"`); continue }
    if (dst.kind !== 'agent') errors.push(`Edge targets non-agent node "${e.toNode}" (sources have no inputs)`)
    if (!outputSocketsOf(src).includes(slugify(e.fromSocket))) errors.push(`Edge "${e.fromNode}.${e.fromSocket}": no such output socket`)
    if (dst.kind === 'agent' && !inputSlotsOf(dst).includes(e.toSocket)) errors.push(`Edge "${e.toNode}.${e.toSocket}": no such input slot`)
    const key = `${e.toNode}.${e.toSocket}`
    incoming.set(key, (incoming.get(key) || 0) + 1)
  }
  for (const [key, count] of incoming) if (count > 1) errors.push(`Input slot "${key}" has ${count} incoming edges (only one allowed)`)

  if (topoOrder(chain).length !== chain.nodes.length) errors.push('Chain has a cycle')

  return { valid: errors.length === 0, errors }
}
