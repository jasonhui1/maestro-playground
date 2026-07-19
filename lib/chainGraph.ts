import { ChainDef, ChainNode, AgentDef, ValidationResult } from './types'
import { slugify } from './graph'
import { kindOf, allKinds } from './nodeKinds'

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

import { ValidationIssue } from './types'

export function validateChain(chain: ChainDef, agents: AgentDef[], chains: ChainDef[] = []): ValidationResult {
  const errors: string[] = []
  const issues: ValidationIssue[] = []
  const add = (message: string, ref: Omit<ValidationIssue, 'message' | 'severity'> = {}) => {
    errors.push(message)
    issues.push({ message, severity: 'error', ...ref })
  }
  // Non-blocking: surfaced in the issues panel but does not invalidate the chain.
  const warn = (message: string, ref: Omit<ValidationIssue, 'message' | 'severity'> = {}) => {
    issues.push({ message, severity: 'warning', ...ref })
  }

  const seenIds = new Set<string>()
  for (const n of chain.nodes) {
    if (!n.id) {
      add('Node is missing ID')
    } else if (seenIds.has(n.id)) {
      add(`Duplicate node ID "${n.id}"`, { nodeId: n.id })
    }
    seenIds.add(n.id)
  }

  const nodeById = new Map(chain.nodes.map(n => [n.id, n]))
  const agentBySlug = new Map(agents.map(a => [a.slug, a]))
  const workspace = { chain, agents, chains }

  const acceptsInputs = (n: ChainNode): boolean => kindOf(n.kind)?.acceptsInputs === true

  const allowedKinds = new Set<string>(allKinds)
  const refRe = /\{([^.}]+)\.[^}]+\}/g
  const checkRefs = (label: string, expr: string | undefined, nodeId: string) => {
    if (!expr) return
    let m: RegExpExecArray | null
    refRe.lastIndex = 0
    while ((m = refRe.exec(expr)) !== null) {
      if (!nodeById.has(m[1])) add(`${label}: condition references unknown node "${m[1]}"`, { nodeId })
    }
  }

  for (const n of chain.nodes) {
    if (!allowedKinds.has(n.kind)) add(`Node "${n.id}": invalid or missing kind "${n.kind}"`, { nodeId: n.id })
    if ((n.kind === 'agent' || n.kind === 'decider') && (!n.agent || !agentBySlug.has(n.agent))) add(`Node "${n.id}": agent "${n.agent ?? ''}" not found`, { nodeId: n.id })
    if (n.kind === 'context' && !n.file) add(`Node "${n.id}": context node missing "file"`, { nodeId: n.id })
    if (n.kind === 'gate') {
      if (!n.condition || !n.condition.trim()) add(`Node "${n.id}": gate needs a condition`, { nodeId: n.id })
      checkRefs(`Node "${n.id}"`, n.condition, n.id)
    }
    if (n.kind === 'branch') {
      if (!n.cases || n.cases.length === 0) add(`Node "${n.id}": branch needs at least one case`, { nodeId: n.id })
      const labels = new Set<string>()
      for (const c of n.cases || []) {
        if (labels.has(c.label)) add(`Node "${n.id}": duplicate case label "${c.label}"`, { nodeId: n.id })
        labels.add(c.label)
        checkRefs(`Node "${n.id}" case "${c.label}"`, c.condition, n.id)
      }
    }
    if (n.kind === 'report') {
      if (!chain.edges.some(e => e.toNode === n.id && e.toSocket === 'in')) {
        warn(`Node "${n.id}": report has no incoming edge`, { nodeId: n.id })
      }
    }
  }

  const incoming = new Map<string, number>()
  for (const e of chain.edges) {
    const src = nodeById.get(e.fromNode)
    const dst = nodeById.get(e.toNode)
    if (!src) { add(`Edge from unknown node "${e.fromNode}"`, { edge: e }); continue }
    if (!dst) { add(`Edge to unknown node "${e.toNode}"`, { edge: e }); continue }
    if (!acceptsInputs(dst)) add(`Edge targets node "${e.toNode}" which has no inputs`, { edge: e })
    if (!kindOf(src.kind).outputs(src, workspace).map(slugify).includes(slugify(e.fromSocket))) {
      if (src.kind === 'branch') {
        add(`Edge "${e.fromNode}.${e.fromSocket}": no such branch case`, { edge: e })
      } else {
        add(`Edge "${e.fromNode}.${e.fromSocket}": no such output socket`, { edge: e })
      }
    }
    if (acceptsInputs(dst) && !kindOf(dst.kind).inputs(dst, workspace).map(s => s.name).includes(e.toSocket)) add(`Edge "${e.toNode}.${e.toSocket}": no such input slot`, { edge: e })
    const key = `${e.toNode}.${e.toSocket}`
    incoming.set(key, (incoming.get(key) || 0) + 1)
  }
  for (const [key, count] of incoming) {
    if (count > 1) {
      add(`Input slot "${key}" has ${count} incoming edges (only one allowed)`, { nodeId: key.split('.')[0] })
    }
  }

  if (topoOrder(chain).length !== chain.nodes.length) add('Chain has a cycle')

  validateZones(chain, add)
  validateSubchains(chain, chains, add, warn)
  return { valid: errors.length === 0, errors, issues }
}

function validateZones(chain: ChainDef, add: (message: string, ref?: Omit<ValidationIssue, 'message' | 'severity'>) => void) {
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
    if (starts.length !== 1) add(`Zone "${zid}": needs exactly one loop-start (found ${starts.length})`, { zone: zid })
    if (ends.length !== 1) add(`Zone "${zid}": needs exactly one loop-end (found ${ends.length})`, { zone: zid })
    const end = ends[0]
    if (end) {
      if (!end.until || !end.until.trim()) add(`Zone "${zid}": loop-end needs an "until" condition`, { zone: zid, nodeId: end.id })
      if (!end.maxIterations || end.maxIterations < 1 || !Number.isInteger(end.maxIterations)) add(`Zone "${zid}": loop-end needs a positive integer maxIterations`, { zone: zid, nodeId: end.id })
    }
  }
  // boundary rule: an edge between different zones is allowed only into loop-start or out of loop-end
  const kindOf = new Map(chain.nodes.map(n => [n.id, n.kind]))
  for (const e of chain.edges) {
    const fz = zoneOf.get(e.fromNode); const tz = zoneOf.get(e.toNode)
    if (fz === tz) continue
    const intoStart = kindOf.get(e.toNode) === 'loop-start'
    const outOfEnd = kindOf.get(e.fromNode) === 'loop-end'
    if (!intoStart && !outOfEnd) add(`Edge "${e.fromNode}.${e.fromSocket}" -> "${e.toNode}.${e.toSocket}" crosses a zone boundary (only loop-start/loop-end may cross)`, { edge: e })
  }
}

function validateSubchains(
  chain: ChainDef,
  chains: ChainDef[],
  add: (message: string, ref?: Omit<ValidationIssue, 'message' | 'severity'>) => void,
  warn: (message: string, ref?: Omit<ValidationIssue, 'message' | 'severity'>) => void,
) {
  const bySlug = new Map(chains.map(c => [c.slug, c]))
  // The edited chain takes precedence over any on-disk copy carrying the same slug.
  const chainBySlug = (slug: string): ChainDef | undefined =>
    slug === chain.slug ? chain : bySlug.get(slug)
  const refsOf = (c: ChainDef): string[] =>
    c.nodes.filter(n => n.kind === 'subchain' && n.subchain).map(n => n.subchain as string)

  for (const n of chain.nodes) {
    if (n.kind !== 'subchain') continue
    if (!n.subchain) { add(`Node "${n.id}": subchain has no chain reference`, { nodeId: n.id }); continue }
    const target = chainBySlug(n.subchain)
    if (!target) { add(`Node "${n.id}": references unknown chain "${n.subchain}"`, { nodeId: n.id }); continue }
    if (!target.outputs || target.outputs.length === 0) {
      // Non-blocking: a side-effect-only subchain can still run, it just exposes nothing to wire.
      warn(`Node "${n.id}": referenced chain "${n.subchain}" declares no outputs (nothing to wire)`, { nodeId: n.id })
    }
  }

  // Detect any cycle in the chain-reference graph reachable from `chain`, not just
  // cycles that pass back through the edited chain (DFS with a recursion stack).
  const visiting = new Set<string>()
  const settled = new Set<string>()
  const hasCycle = (slug: string): boolean => {
    if (visiting.has(slug)) return true
    if (settled.has(slug)) return false
    const c = chainBySlug(slug)
    if (!c) return false // unknown ref — reported separately above
    visiting.add(slug)
    for (const r of refsOf(c)) if (hasCycle(r)) return true
    visiting.delete(slug)
    settled.add(slug)
    return false
  }
  if (hasCycle(chain.slug)) add(`Chain "${chain.slug}" has a subchain reference cycle`, {})
}
