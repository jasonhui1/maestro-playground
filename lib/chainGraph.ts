import { ChainDef, ChainNode, ChainEdge, ToolDef, ValidationIssue, ValidationResult, WorkspaceWarning } from './types'
import type { RunDefinitions } from './runDefinitions'
import { inputAcceptsMany, kindOf, allKinds, resolveNodeSkills, unknownSkillNames } from './nodeKinds'
import { isValidExecutorId } from './tools/spec'
import { forbiddenAgentFieldMessage } from './fs/validate'
import { scanTokens, endpointOf, socketKey } from './tokens'
import { wiredByIssues } from './dice'
import { topoSort } from './topoSort'
import { zoneIssues } from './zones'

type AddIssue = (message: string, ref?: Omit<ValidationIssue, 'message' | 'severity'>) => void
/** A ref's "not found" message, or the clash that left the name out of the load (#151). */
type MissingRef = (entityType: WorkspaceWarning['entityType'], name: string, notFound: string) => string

function missingRefMessage(warnings: WorkspaceWarning[]): MissingRef {
  const byType = new Map<WorkspaceWarning['entityType'], Map<string, string>>()
  for (const w of warnings) byType.set(w.entityType, (byType.get(w.entityType) ?? new Map()).set(w.name, w.message))
  return (entityType, name, notFound) => byType.get(entityType)?.get(name) ?? notFound
}

export const topoOrder = (chain: ChainDef): string[] => topoSort(chain.nodes.map(n => n.id), chain.edges)

// Shape rules an edge breaks on its own, before any node or socket lookup. The canvas
// refuses a drag that breaks one (edgeFromConnection), so it enforces nothing more (#119).
export function edgeShapeError(e: ChainEdge): string | null {
  if (!e.fromSocket || !e.toSocket) return `Edge "${e.fromNode}" -> "${e.toNode}" has an unnamed socket`
  if (e.fromNode === e.toNode) return `Edge "${e.fromNode}.${e.fromSocket}" -> "${e.toNode}.${e.toSocket}" connects a node to itself`
  return null
}

export function hasLiteralInput(node: { inputs?: Record<string, string> } | undefined, slot: string): boolean {
  return node?.inputs !== undefined && Object.hasOwn(node.inputs, slot)
}

export function issuesByNode(issues: ValidationIssue[]): Map<string, string[]> {
  const m = new Map<string, string[]>()
  for (const i of issues) {
    const id = i.nodeId ?? i.edge?.toNode
    if (!id) continue
    m.set(id, [...(m.get(id) ?? []), i.message])
  }
  return m
}

export function validateChain(
  chain: ChainDef,
  defs: Partial<RunDefinitions> = {}
): ValidationResult {
  const { agents = [], chains = [], tools = [], skills = [], warnings = [] } = defs
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

  const missing = missingRefMessage(warnings)

  const seenIds = new Set<string>()
  const hasWiredIn = (n: ChainNode) => chain.edges.some(e => e.toNode === n.id && e.toSocket === 'in')
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
  const workspace = { chain, agents, chains, tools }

  // Tool refs match by frontmatter `name` (like skills), not filename slug.
  const toolByName = new Map<string, ToolDef>()
  const toolNameCounts = new Map<string, number>()
  for (const t of tools) {
    toolByName.set(t.name, t)
    toolNameCounts.set(t.name, (toolNameCounts.get(t.name) || 0) + 1)
  }
  for (const [name, count] of toolNameCounts) {
    if (count > 1) add(`Duplicate tool name "${name}" across tool files`)
  }

  const acceptsInputs = (n: ChainNode): boolean => kindOf(n.kind)?.acceptsInputs === true

  const allowedKinds = new Set<string>(allKinds)
  const checkRefs = (label: string, expr: string | undefined, nodeId: string) => {
    if (!expr) return
    for (const t of scanTokens(expr)) {
      const { node } = endpointOf(t)
      if (!nodeById.has(node)) add(`${label}: condition references unknown node "${node}"`, { nodeId })
    }
  }

  for (const n of chain.nodes) {
    if (!allowedKinds.has(n.kind)) add(`Node "${n.id}": invalid or missing kind "${n.kind}"`, { nodeId: n.id })
    if (n.kind === 'agent' || n.kind === 'decider') {
      if (!n.agent || !agentBySlug.has(n.agent)) {
        add(
          n.agent
            ? missing('agent', n.agent, `Node "${n.id}": agent "${n.agent}" not found`)
            : `Node "${n.id}": agent "" not found`,
          { nodeId: n.id },
        )
      }
      const nodeAgent = n.agent ? agentBySlug.get(n.agent) : undefined
      const forbidden = nodeAgent?.resolution?.forbidden ?? []
      if (forbidden.length) {
        add(`Node "${n.id}": agent "${nodeAgent!.slug}" — ${forbiddenAgentFieldMessage(forbidden)}`, { nodeId: n.id })
      }
      // Checks the resolved list, not just skills!/skills+ — an agent's own defaults
      // can name a missing skill too (#132).
      if (nodeAgent) {
        const resolved = resolveNodeSkills(n, nodeAgent.skills ?? [])
        for (const skillRef of unknownSkillNames(resolved, skills)) {
          // Skills and tools are named by frontmatter `name`, which a clash (keyed by
          // file name) only matches when the two agree.
          add(missing('skill', skillRef, `Node "${n.id}": agent "${nodeAgent.slug}" names skill "${skillRef}", which does not exist`), { nodeId: n.id })
        }
      }
      for (const toolRef of nodeAgent?.tools ?? []) {
        if (typeof toolRef !== 'string') {
          add(`Node "${n.id}": agent "${nodeAgent!.slug}" has a non-string tools entry (inline tool config lands in Slice 5)`, { nodeId: n.id })
          continue
        }
        const tool = toolByName.get(toolRef)
        if (!tool) {
          add(missing('tool', toolRef, `Node "${n.id}": agent "${nodeAgent!.slug}" references unknown tool "${toolRef}"`), { nodeId: n.id })
        } else if (!isValidExecutorId(tool.executor)) {
          add(`Node "${n.id}": tool "${toolRef}" has unknown executor "${tool.executor}"`, { nodeId: n.id })
        }
      }
    }
    if (n.kind === 'tool') {
      const tool = toolByName.get(n.tool ?? '')
      if (!tool) add(missing('tool', n.tool ?? '', `Node "${n.id}": tool "${n.tool ?? ''}" not found`), { nodeId: n.id })
      else if (!isValidExecutorId(tool.executor)) add(`Node "${n.id}": tool "${tool.name}" has unknown executor "${tool.executor}"`, { nodeId: n.id })
    }
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
    if (n.kind === 'report' && !hasWiredIn(n)) warn(`Node "${n.id}": report has no incoming edge`, { nodeId: n.id })
    if (n.kind === 'join' && !hasWiredIn(n)) warn(`Node "${n.id}": join has no incoming edges`, { nodeId: n.id })
    if (n.kind === 'hold' && !hasWiredIn(n)) add(`Node "${n.id}": hold needs its "in" input wired`, { nodeId: n.id })
    if (n.inputs !== undefined) {
      if (typeof n.inputs !== 'object' || n.inputs === null || Array.isArray(n.inputs)) {
        add(`Node "${n.id}": inputs must be a key-value mapping`, { nodeId: n.id })
      } else if (!kindOf(n.kind).acceptsLiterals) {
        add(`Node "${n.id}" of kind "${n.kind}" does not accept literal inputs`, { nodeId: n.id })
      } else {
        const declared = new Set(kindOf(n.kind).inputs(n, workspace).map(s => s.name))
        for (const [k, v] of Object.entries(n.inputs)) {
          if (!declared.has(k)) {
            add(`Node "${n.id}": literal declared for unknown input slot "${k}"`, { nodeId: n.id })
          } else if (typeof v !== 'string') {
            add(`Node "${n.id}": literal for slot "${k}" must be a string`, { nodeId: n.id })
          }
        }
      }
    }
  }

  const incoming = new Map<string, number>()
  for (const e of chain.edges) {
    const shape = edgeShapeError(e)
    if (shape) { add(shape, { edge: e }); continue }
    const src = nodeById.get(e.fromNode)
    const dst = nodeById.get(e.toNode)
    if (!src) { add(`Edge from unknown node "${e.fromNode}"`, { edge: e }); continue }
    if (!dst) { add(`Edge to unknown node "${e.toNode}"`, { edge: e }); continue }
    if (!acceptsInputs(dst)) add(`Edge targets node "${e.toNode}" which has no inputs`, { edge: e })
    if (!kindOf(src.kind).outputs(src, workspace).map(socketKey).includes(socketKey(e.fromSocket))) {
      if (src.kind === 'branch') {
        add(`Edge "${e.fromNode}.${e.fromSocket}": no such branch case`, { edge: e })
      } else {
        add(`Edge "${e.fromNode}.${e.fromSocket}": no such output socket`, { edge: e })
      }
    }
    if (acceptsInputs(dst) && !kindOf(dst.kind).inputs(dst, workspace).map(s => s.name).includes(e.toSocket)) add(`Edge "${e.toNode}.${e.toSocket}": no such input slot`, { edge: e })
    if (!inputAcceptsMany(dst, e.toSocket, workspace)) {
      const key = `${e.toNode}.${e.toSocket}`
      incoming.set(key, (incoming.get(key) || 0) + 1)
    }
  }
  for (const [key, count] of incoming) {
    if (count > 1) {
      add(`Input slot "${key}" has ${count} incoming edges (only one allowed)`, { nodeId: key.split('.')[0] })
    }
  }

  if (topoOrder(chain).length !== chain.nodes.length) add('Chain has a cycle')
  for (const { nodeId, message } of wiredByIssues(chain, { agents })) add(message, { nodeId })

  for (const { message, ...ref } of zoneIssues(chain)) add(message, ref)
  validateSubchains(chain, chains, { add, warn, missing })
  validateHoldPlacement(chain, chains, add)

  // `readSocket` dispatches every `kind: 'param'` node to the run's one value by
  // kind alone (#69) — `parameter.node` only stays meaningful if it is the chain's
  // only param node, checked here rather than threaded into that general function.
  const paramNodes = chain.nodes.filter(n => n.kind === 'param')
  if (chain.parameter) {
    if (paramNodes.length > 1) add(`Chain declares a parameter but has ${paramNodes.length} "param" nodes (must be exactly one)`)
    else if (!nodeById.has(chain.parameter.node) || nodeById.get(chain.parameter.node)?.kind !== 'param') {
      add(`Declared parameter's node "${chain.parameter.node}" is not a "param" node`)
    }
  } else if (paramNodes.length > 0) {
    add(`Chain has a "param" node but declares no parameter`)
  }

  const seenInputNames = new Set<string>()
  for (const p of chain.inputs ?? []) {
    const name = p.name.trim()
    if (!name) add(`Chain declares an input with no name`)
    else if (seenInputNames.has(name)) add(`Chain declares duplicate input name "${name}"`)
    seenInputNames.add(name)
    if (nodeById.get(p.node)?.kind !== 'seed') add(`Input "${p.name}" binds to "${p.node}", which is not a "seed" node`)
  }
  return { valid: errors.length === 0, errors, issues }
}

// The edited chain takes precedence over any on-disk copy carrying the same slug.
function chainLookup(chain: ChainDef, chains: ChainDef[]): (slug: string) => ChainDef | undefined {
  const bySlug = new Map(chains.map(c => [c.slug, c]))
  return slug => (slug === chain.slug ? chain : bySlug.get(slug))
}

const refsOf = (c: ChainDef): string[] =>
  c.nodes.flatMap(n => (n.kind === 'subchain' && n.subchain ? [n.subchain] : []))

// A nested run cannot surface a pause, so a hold may not sit in any chain run as a subchain.
function validateHoldPlacement(
  chain: ChainDef,
  chains: ChainDef[],
  add: AddIssue,
) {
  const holds = chain.nodes.filter(n => n.kind === 'hold')
  const users = holds.length
    ? chains.filter(c => c.slug !== chain.slug && refsOf(c).includes(chain.slug)).map(c => `"${c.slug}"`)
    : []
  if (users.length) {
    for (const h of holds) add(`Node "${h.id}": a hold cannot sit in a chain used as a subchain (used by ${users.join(', ')})`, { nodeId: h.id })
  }

  const chainBySlug = chainLookup(chain, chains)
  const holdCache = new Map<string, boolean>()
  const reachesHold = (slug: string): boolean => {
    if (holdCache.has(slug)) return holdCache.get(slug)!
    holdCache.set(slug, false) // cycle guard; cycles are reported by validateSubchains
    const c = chainBySlug(slug)
    const found = !!c && (c.nodes.some(n => n.kind === 'hold') || refsOf(c).some(reachesHold))
    holdCache.set(slug, found)
    return found
  }
  for (const n of chain.nodes) {
    if (n.kind === 'subchain' && n.subchain && n.subchain !== chain.slug && reachesHold(n.subchain)) {
      add(`Node "${n.id}": subchain "${n.subchain}" contains a hold, which cannot run inside a subchain`, { nodeId: n.id })
    }
  }
}

function validateSubchains(
  chain: ChainDef,
  chains: ChainDef[],
  { add, warn, missing }: { add: AddIssue; warn: AddIssue; missing: MissingRef },
) {
  const chainBySlug = chainLookup(chain, chains)

  for (const n of chain.nodes) {
    if (n.kind !== 'subchain') continue
    if (!n.subchain) { add(`Node "${n.id}": subchain has no chain reference`, { nodeId: n.id }); continue }
    const target = chainBySlug(n.subchain)
    if (!target) { add(missing('chain', n.subchain, `Node "${n.id}": references unknown chain "${n.subchain}"`), { nodeId: n.id }); continue }
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
