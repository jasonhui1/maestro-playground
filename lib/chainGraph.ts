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

  const stateNamesByZone = new Map<string, string[]>()
  for (const n of chain.nodes) if (n.kind === 'loop-start' && n.zone) stateNamesByZone.set(n.zone, n.state || [])
  const zoneStateOf = (n: ChainNode): string[] => (n.zone ? stateNamesByZone.get(n.zone) || [] : [])

  const inputSlotsOf = (n: ChainNode): string[] => {
    if (n.kind === 'agent' || n.kind === 'decider') {
      const a = n.agent ? agentBySlug.get(n.agent) : undefined
      return a ? parseSlots(a.systemPrompt) : []
    }
    if (n.kind === 'gate' || n.kind === 'branch') return ['in']
    if (n.kind === 'loop-start' || n.kind === 'loop-end') return zoneStateOf(n)
    return []
  }
  const outputSocketsOf = (n: ChainNode): string[] => {
    if (n.kind === 'seed' || n.kind === 'context') return ['output']
    if (n.kind === 'gate') return ['output']
    if (n.kind === 'branch') return [...(n.cases || []).map(c => c.label), ...(n.default ? [n.default] : [])]
    if (n.kind === 'loop-start' || n.kind === 'loop-end') return zoneStateOf(n)
    const a = n.agent ? agentBySlug.get(n.agent) : undefined
    return ['output', ...(a?.outputs || []).map(s => slugify(s.name))]
  }
  const acceptsInputs = (n: ChainNode): boolean =>
    n.kind === 'agent' || n.kind === 'decider' || n.kind === 'gate' || n.kind === 'branch' || n.kind === 'loop-start' || n.kind === 'loop-end'

  const allowedKinds = new Set<string>(['seed', 'context', 'agent', 'gate', 'branch', 'decider', 'loop-start', 'loop-end'])
  const refRe = /\{([^.}]+)\.[^}]+\}/g
  const checkRefs = (label: string, expr: string | undefined) => {
    if (!expr) return
    let m: RegExpExecArray | null
    refRe.lastIndex = 0
    while ((m = refRe.exec(expr)) !== null) {
      if (!nodeById.has(m[1])) errors.push(`${label}: condition references unknown node "${m[1]}"`)
    }
  }

  for (const n of chain.nodes) {
    if (!allowedKinds.has(n.kind)) errors.push(`Node "${n.id}": invalid or missing kind "${n.kind}"`)
    if ((n.kind === 'agent' || n.kind === 'decider') && (!n.agent || !agentBySlug.has(n.agent))) errors.push(`Node "${n.id}": agent "${n.agent ?? ''}" not found`)
    if (n.kind === 'context' && !n.file) errors.push(`Node "${n.id}": context node missing "file"`)
    if (n.kind === 'gate') {
      if (!n.condition || !n.condition.trim()) errors.push(`Node "${n.id}": gate needs a condition`)
      checkRefs(`Node "${n.id}"`, n.condition)
    }
    if (n.kind === 'branch') {
      if (!n.cases || n.cases.length === 0) errors.push(`Node "${n.id}": branch needs at least one case`)
      const labels = new Set<string>()
      for (const c of n.cases || []) {
        if (labels.has(c.label)) errors.push(`Node "${n.id}": duplicate case label "${c.label}"`)
        labels.add(c.label)
        checkRefs(`Node "${n.id}" case "${c.label}"`, c.condition)
      }
    }
  }

  const incoming = new Map<string, number>()
  for (const e of chain.edges) {
    const src = nodeById.get(e.fromNode)
    const dst = nodeById.get(e.toNode)
    if (!src) { errors.push(`Edge from unknown node "${e.fromNode}"`); continue }
    if (!dst) { errors.push(`Edge to unknown node "${e.toNode}"`); continue }
    if (!acceptsInputs(dst)) errors.push(`Edge targets node "${e.toNode}" which has no inputs`)
    if (!outputSocketsOf(src).includes(slugify(e.fromSocket))) {
      if (src.kind === 'branch') {
        errors.push(`Edge "${e.fromNode}.${e.fromSocket}": no such branch case`)
      } else {
        errors.push(`Edge "${e.fromNode}.${e.fromSocket}": no such output socket`)
      }
    }
    if (acceptsInputs(dst) && !inputSlotsOf(dst).includes(e.toSocket)) errors.push(`Edge "${e.toNode}.${e.toSocket}": no such input slot`)
    const key = `${e.toNode}.${e.toSocket}`
    incoming.set(key, (incoming.get(key) || 0) + 1)
  }
  for (const [key, count] of incoming) if (count > 1) errors.push(`Input slot "${key}" has ${count} incoming edges (only one allowed)`)

  if (topoOrder(chain).length !== chain.nodes.length) errors.push('Chain has a cycle')

  validateZones(chain, errors)
  return { valid: errors.length === 0, errors }
}

function validateZones(chain: ChainDef, errors: string[]) {
  const byZone = new Map<string, ChainNode[]>()
  for (const n of chain.nodes) {
    if (!n.zone) continue
    const arr = byZone.get(n.zone) ?? []
    arr.push(n); byZone.set(n.zone, arr)
  }
  const zoneOf = new Map(chain.nodes.map(n => [n.id, n.zone]))
  for (const [zid, members] of byZone) {
    const starts = members.filter(n => n.kind === 'loop-start')
    const ends = members.filter(n => n.kind === 'loop-end')
    if (starts.length !== 1) errors.push(`Zone "${zid}": needs exactly one loop-start (found ${starts.length})`)
    if (ends.length !== 1) errors.push(`Zone "${zid}": needs exactly one loop-end (found ${ends.length})`)
    const end = ends[0]
    if (end) {
      if (!end.until || !end.until.trim()) errors.push(`Zone "${zid}": loop-end needs an "until" condition`)
      if (!end.maxIterations || end.maxIterations < 1 || !Number.isInteger(end.maxIterations)) errors.push(`Zone "${zid}": loop-end needs a positive integer maxIterations`)
    }
  }
  // boundary rule: an edge between different zones is allowed only into loop-start or out of loop-end
  const kindOf = new Map(chain.nodes.map(n => [n.id, n.kind]))
  for (const e of chain.edges) {
    const fz = zoneOf.get(e.fromNode); const tz = zoneOf.get(e.toNode)
    if (fz === tz) continue
    const intoStart = kindOf.get(e.toNode) === 'loop-start'
    const outOfEnd = kindOf.get(e.fromNode) === 'loop-end'
    if (!intoStart && !outOfEnd) errors.push(`Edge "${e.fromNode}.${e.fromSocket}" -> "${e.toNode}.${e.toSocket}" crosses a zone boundary (only loop-start/loop-end may cross)`)
  }
}
