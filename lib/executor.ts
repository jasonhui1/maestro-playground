import { ChainDef, ChainNode, AgentDef, SkillDef, AgentOutput, ToolDef, HoldRecord } from './types'
import { makeContextReader } from './fs/contextReader'
import { runAgent } from './runner'
import { bindAgentTools } from './tools/registry'
import { injectSkills } from './prompt'
import { resolveNodePrompt, readSocket } from './resolveNode'
import { SectionWarning, sameSectionWarning, emitSectionWarnings } from './sectionWarning'
import { topoOrder, hasLiteralInput } from './chainGraph'
import { evalCondition } from './condition'
import { outputKey, socketKey, isWholeOutput } from './tokens'
import { openHold } from './hold'
import { kindOf, agentSlugOf, resolveNodeSkills, zoneStateName, type WorkspaceLookup } from './nodeKinds'
import type { ToolLoopEvent } from './tools/events'

export interface RunCallbacks {
  onStart: (nodeId: string, agentName: string) => void
  onToken: (nodeId: string, token: string, type?: 'thought' | 'output', turn?: number) => void
  onDone: (nodeId: string, output: AgentOutput) => void
  // Optional so existing three-member literals still satisfy this (#35).
  onToolEvent?: (nodeId: string, event: ToolLoopEvent) => void
  // Carries both endpoints, so it takes no separate nodeId (#37).
  onWarning?: (warning: SectionWarning) => void
  // The run pauses after the current wave settles; the hold itself records nothing (#93).
  onHold?: (hold: HoldRecord) => void
}

function controlOutput(nodeId: string, label: string, output: string, status: AgentOutput['status']): AgentOutput {
  return { nodeId, agentName: label, systemPrompt: '', input: '', output,
    tokensIn: 0, tokensOut: 0, costUsd: 0, latencyMs: 0, model: '', timestamp: new Date().toISOString(), status }
}

/** The definitions a run reads. `root` alone is required: an empty one silently
 * resolves context and tool files against the process cwd (#105). */
export interface ExecutorDefs {
  root: string
  agents?: AgentDef[]
  skills?: SkillDef[]
  chains?: ChainDef[]
  tools?: ToolDef[]
}

/** What one run supplies over those definitions. */
export interface RunRequest {
  /** The text the chain's seed node hands downstream. */
  seedPrompt: string
  /** The chain parameter's value for this run; '' when the chain declares none. */
  paramValue?: string
  /** Context files supplied inline, overriding the ones on disk. */
  context?: Record<string, string>
  /** Outputs handed to the graph as already done: a resume, a fork, or an answered hold. */
  replay?: AgentOutput[]
  /** The agent runner; ADR-0002 fixes its shape. */
  run?: typeof runAgent
  /** Subchain recursion depth; callers outside the executor leave it at 0. */
  depth?: number
  /** Model override for this run (#128). */
  modelOverride?: string
}

export async function runChainGraph(
  chain: ChainDef,
  defs: ExecutorDefs,
  callbacks: RunCallbacks,
  request: RunRequest,
): Promise<AgentOutput[]> {
  const { root: workspacePath, agents = [], skills = [], chains = [], tools = [] } = defs
  const { seedPrompt, paramValue = '', context: contextOverrides = {}, replay: startOutputs = [],
    run: runFn = runAgent, depth = 0, modelOverride } = request
  const MAX_SUBCHAIN_DEPTH = 10
  if (depth > MAX_SUBCHAIN_DEPTH) throw new Error('subchain recursion too deep')
  const agentBySlug = new Map(agents.map(a => [a.slug, a]))
  const nodeById = new Map(chain.nodes.map(n => [n.id, n]))
  const readContext = makeContextReader(workspacePath, contextOverrides)

  const nodeOutputs = new Map<string, AgentOutput>()

  const buckets = new Map<string, AgentOutput[]>()
  const emit = (anchorId: string, rec: AgentOutput) => {
    const arr = buckets.get(anchorId) ?? []
    arr.push(rec)
    buckets.set(anchorId, arr)
  }

  // edge liveness, keyed by edge index
  const live = new Set<number>()
  const incomingByNode = new Map<string, number[]>()
  chain.edges.forEach((e, i) => {
    const arr = incomingByNode.get(e.toNode) || []; arr.push(i); incomingByNode.set(e.toNode, arr)
  })
  const markOut = (nodeId: string, pred: (e: typeof chain.edges[number]) => boolean) => {
    chain.edges.forEach((e, i) => { if (e.fromNode === nodeId && pred(e)) live.add(i) })
  }
  const liveEdgeForSlot = (nodeId: string, slot: string): number | undefined =>
    (incomingByNode.get(nodeId) || []).find(i => chain.edges[i].toSocket === slot && live.has(i))

  const lookup: WorkspaceLookup = { chain, agents, chains }
  // A node is skipped unless every non-optional input has a live edge; an
  // optional input (subchain only, today) counts only if it is actually wired —
  // an unwired optional input never blocks the node.
  const usedSlots = (node: ChainNode): string[] => {
    const wired = new Set((incomingByNode.get(node.id) ?? []).map(i => chain.edges[i].toSocket))
    return kindOf(node.kind).inputs(node, lookup)
      .filter(s => !s.optional || wired.has(s.name))
      .map(s => s.name)
  }
  const inputsAvailable = (node: ChainNode): boolean => usedSlots(node).every(slot => {
    const connected = (incomingByNode.get(node.id) || []).some(index => chain.edges[index].toSocket === slot)
    if (connected) return liveEdgeForSlot(node.id, slot) !== undefined
    return (node.kind === 'agent' || node.kind === 'decider') && hasLiteralInput(node, slot)
  })
  const recordSkipped = (node: ChainNode, anchorId: string = node.id, round?: number): void => {
    const skipped = controlOutput(node.id, agentSlugOf(node) || node.kind, '', 'skipped')
    if (round !== undefined) skipped.round = round
    nodeOutputs.set(node.id, skipped); emit(anchorId, skipped); callbacks.onDone(node.id, skipped)
  }
  // Deduped against the producing output, not the run: several readers of one bad
  // output warn once, but a later loop round is a new output and warns again (#37).
  const reportWarning = (w: SectionWarning) => {
    const producer = nodeOutputs.get(w.fromNode)
    if (producer?.warnings?.some(x => sameSectionWarning(x, w))) return
    if (producer) producer.warnings = [...(producer.warnings ?? []), w]
    callbacks.onWarning?.(w)
  }

  const edgeValue = (e: typeof chain.edges[number]): string => {
    const src = nodeById.get(e.fromNode)
    if (!src) return ''
    const read = readSocket(src, e.fromSocket, nodeOutputs, seedPrompt, readContext, paramValue)
    emitSectionWarnings(read, e.fromNode, e.toNode, e.toSocket, reportWarning)
    return read.value
  }

  // A join's section heading, so the synthesizer downstream can tell contributors apart.
  const joinLabel = (e: typeof chain.edges[number]): string => {
    const src = nodeById.get(e.fromNode)
    const slug = src ? agentSlugOf(src) : undefined
    const base = (slug ? agentBySlug.get(slug)?.name : undefined) ?? slug ?? e.fromNode
    return isWholeOutput(e.fromSocket) ? base : `${base} (${e.fromSocket})`
  }

  const slotValue = (nodeId: string, slot: string): string => {
    const idx = liveEdgeForSlot(nodeId, slot)
    return idx === undefined ? '' : edgeValue(chain.edges[idx])
  }
  const inValue = (nodeId: string): string => slotValue(nodeId, 'in')

  const runAgentNode = async (node: ChainNode, agent: AgentDef, round?: number, anchorId: string = node.id): Promise<AgentOutput> => {
    callbacks.onStart(node.id, agent.name)
    // #128: Run override applies immediately before execution without mutating definitions.
    const effectiveAgent: AgentDef = modelOverride ? {
      ...agent,
      model: modelOverride,
      resolution: {
        forbidden: agent.resolution?.forbidden ?? [],
        sources: {
          ...(agent.resolution?.sources ?? {}),
          model: 'run override',
        },
      } as AgentDef['resolution'],
    } : agent
    const resolved = resolveNodePrompt(node, chain, effectiveAgent, nodeOutputs, seedPrompt, readContext, paramValue)
    resolved.warnings.forEach(reportWarning)
    // A per-node `skills!`/`skills+` marker never mutates the shared resolved agent —
    // two nodes naming the same agent may still produce two different system prompts.
    const systemPrompt = injectSkills({ ...effectiveAgent, skills: resolveNodeSkills(node, effectiveAgent.skills) }, skills, resolved.prompt)
    // Binding is all the scheduler knows about tools: it hands the runner a list
    // and gets back one AgentOutput, exactly as before (ADR-0002). Whether that
    // took one API call or nine is entirely below this line.
    const boundTools = bindAgentTools(effectiveAgent, tools, workspacePath)
    const output = await runFn(
      effectiveAgent, systemPrompt, 'Follow your instructions.',
      {
        onToken: (t, ty, turn) => callbacks.onToken(node.id, t, ty, turn),
        boundTools,
        onToolEvent: callbacks.onToolEvent ? e => callbacks.onToolEvent!(node.id, e) : undefined,
      },
    )
    output.nodeId = node.id
    if (round !== undefined) output.round = round
    nodeOutputs.set(node.id, output); emit(anchorId, output); callbacks.onDone(node.id, output)
    return output
  }

  // --- zones ---
  interface ZoneState { name: string; accumulate: boolean; separator: string }
  interface Zone { id: string; startId: string; endId: string; bodyIds: string[]; states: ZoneState[]; until: string; maxIterations: number }
  const zonesByStart = new Map<string, Zone>()
  {
    const byZone = new Map<string, ChainNode[]>()
    for (const n of chain.nodes) if (n.zone) { const a = byZone.get(n.zone) ?? []; a.push(n); byZone.set(n.zone, a) }
    for (const [zid, members] of byZone) {
      const start = members.find(n => n.kind === 'loop-start')
      const end = members.find(n => n.kind === 'loop-end')
      if (!start || !end) continue
      zonesByStart.set(start.id, {
        id: zid, startId: start.id, endId: end.id,
        bodyIds: members.filter(n => n.kind !== 'loop-start' && n.kind !== 'loop-end').map(n => n.id),
        states: (start.state || []).map(state => ({
          name: zoneStateName(state),
          accumulate: typeof state !== 'string' && state.accumulate === true,
          separator: typeof state !== 'string' ? (state.separator ?? '\n\n') : '\n\n',
        })),
        until: end.until || '', maxIterations: end.maxIterations || 1,
      })
    }
  }

  const setStateSockets = (nodeId: string, state: Map<string, string>, anchorId: string = nodeId) => {
    for (const [name, val] of state) {
      const rec = controlOutput(`${nodeId}::${name}`, nodeId, val, 'success')
      nodeOutputs.set(outputKey(nodeId, name), rec)
      emit(anchorId, rec)
    }
  }
  const bodyOrder = (zone: Zone): string[] => {
    const set = new Set(zone.bodyIds)
    const indeg = new Map(zone.bodyIds.map(id => [id, 0]))
    const adj = new Map(zone.bodyIds.map(id => [id, [] as string[]]))
    for (const e of chain.edges) if (set.has(e.fromNode) && set.has(e.toNode)) { adj.get(e.fromNode)!.push(e.toNode); indeg.set(e.toNode, (indeg.get(e.toNode) || 0) + 1) }
    const q = zone.bodyIds.filter(id => (indeg.get(id) || 0) === 0)
    const order: string[] = []
    while (q.length) { const id = q.shift()!; order.push(id); for (const t of adj.get(id) || []) { indeg.set(t, (indeg.get(t) || 0) - 1); if ((indeg.get(t) || 0) === 0) q.push(t) } }
    return order
  }

  const runZone = async (zone: Zone) => {
    const incoming = (id: string) => incomingByNode.get(id) || []
    const roundProducers = new Set([zone.startId, ...zone.bodyIds])
    const roundEdges = chain.edges.flatMap((edge, index) => roundProducers.has(edge.fromNode) ? [index] : [])
    // initial state
    const state = new Map<string, string>()
    for (const stateDef of zone.states) {
      const idx = incoming(zone.startId).find(i => chain.edges[i].toSocket === stateDef.name)
      state.set(stateDef.name, idx !== undefined ? edgeValue(chain.edges[idx]) : '')
    }
    const order = bodyOrder(zone)
    let finalState = state
    for (let round = 0; round < zone.maxIterations; round++) {
      for (const index of roundEdges) live.delete(index)
      setStateSockets(zone.startId, state, zone.startId)
      markOut(zone.startId, () => true)
      for (const id of order) {
        const bn = nodeById.get(id)!
        if (bn.kind === 'agent' || bn.kind === 'decider') {
          if (!inputsAvailable(bn)) {
            recordSkipped(bn, zone.startId, round)
            continue
          }
          const a = bn.agent ? agentBySlug.get(bn.agent) : undefined
          if (a) {
            const replayed = startOutputs.find(o => o.nodeId === bn.id && o.round === round)
            if (replayed) {
              nodeOutputs.set(bn.id, replayed)
              if (replayed.status !== 'skipped') markOut(bn.id, () => true)
            } else {
              await runAgentNode(bn, a, round, zone.startId)
              markOut(bn.id, () => true)
            }
          }
        }
      }
      const newState = new Map<string, string>()
      for (const stateDef of zone.states) {
        const incomingState = incoming(zone.endId).filter(i => chain.edges[i].toSocket === stateDef.name && live.has(i))
        if (stateDef.accumulate) {
          const additions = incomingState.map(i => edgeValue(chain.edges[i]))
          const previous = state.get(stateDef.name) ?? ''
          newState.set(stateDef.name, additions.length === 0
            ? previous
            : [previous, ...additions].filter((value, index) => index > 0 || value !== '').join(stateDef.separator))
        } else {
          const idx = incomingState[0]
          newState.set(stateDef.name, idx !== undefined ? edgeValue(chain.edges[idx]) : (state.get(stateDef.name) || ''))
        }
      }
      finalState = newState
      if (evalCondition(zone.until, nodeOutputs)) break
      state.clear(); for (const [k, v] of newState) state.set(k, v)
    }
    setStateSockets(zone.endId, finalState, zone.startId)
    const rec = controlOutput(zone.endId, 'loop-end', '', 'success')
    nodeOutputs.set(zone.endId, rec); emit(zone.startId, rec); callbacks.onDone(zone.endId, rec)
    markOut(zone.endId, () => true)
  }

  // replay branched outputs (their out-edges are live)
  for (const o of startOutputs) {
    if (o.nodeId) { nodeOutputs.set(o.nodeId, o); markOut(o.nodeId, () => true) }
    emit(o.nodeId || '', o); callbacks.onDone(o.nodeId || '', o)
  }

  const processZoneUnit = async (startZone: Zone): Promise<void> => {
    if (nodeOutputs.has(startZone.endId)) {
      markOut(startZone.endId, () => true)
      return
    }
    const inc = incomingByNode.get(startZone.startId) || []
    const anyLive = inc.length === 0 || inc.some(i => live.has(i))
    if (anyLive) { await runZone(startZone); return }
    // zone is unreachable (blocked upstream): record members skipped
    for (const id of [startZone.startId, ...startZone.bodyIds, startZone.endId]) {
      const subNode = nodeById.get(id)
      const label = subNode ? (agentSlugOf(subNode) || subNode.kind) : 'node'
      const rec = controlOutput(id, label, '', 'skipped')
      nodeOutputs.set(id, rec); emit(startZone.startId, rec); callbacks.onDone(id, rec)
    }
  }

  let held = false
  const processMainNode = async (nodeId: string): Promise<void> => {
    const node = nodeById.get(nodeId)
    if (!node || nodeOutputs.has(nodeId)) { if (node) markOut(nodeId, () => true); return }

    if (node.kind === 'seed' || node.kind === 'context' || node.kind === 'param') { markOut(nodeId, () => true); return }

    if (!inputsAvailable(node)) {
      recordSkipped(node)
      return // out-edges remain dead
    }

    if (node.kind === 'agent' || node.kind === 'decider') {
      const agent = node.agent ? agentBySlug.get(node.agent) : undefined
      if (agent) {
        await runAgentNode(node, agent)
        markOut(nodeId, () => true)
      }
    } else if (node.kind === 'gate') {
      const pass = evalCondition(node.condition || '', nodeOutputs)
      const rec = controlOutput(nodeId, `gate: ${pass ? 'PASS' : 'BLOCK'}`, pass ? inValue(nodeId) : '', 'success')
      nodeOutputs.set(nodeId, rec); emit(nodeId, rec); callbacks.onDone(nodeId, rec)
      if (pass) markOut(nodeId, () => true)
    } else if (node.kind === 'branch') {
      const active = (node.cases || []).find(c => evalCondition(c.condition, nodeOutputs))?.label ?? node.default
      const rec = controlOutput(nodeId, `branch: ${active ?? 'none'}`, inValue(nodeId), 'success')
      nodeOutputs.set(nodeId, rec); emit(nodeId, rec); callbacks.onDone(nodeId, rec)
      if (active) markOut(nodeId, e => socketKey(e.fromSocket) === socketKey(active))
    } else if (node.kind === 'report') {
      const rec = controlOutput(nodeId, 'report', inValue(nodeId), 'success')
      nodeOutputs.set(nodeId, rec); emit(nodeId, rec); callbacks.onDone(nodeId, rec)
      markOut(nodeId, () => true)
    } else if (node.kind === 'join') {
      const blocks = (incomingByNode.get(nodeId) || []).filter(i => live.has(i))
        .map(i => `## ${joinLabel(chain.edges[i])}\n${edgeValue(chain.edges[i])}`)
      const rec = controlOutput(nodeId, 'join', blocks.join('\n\n'), 'success')
      nodeOutputs.set(nodeId, rec); emit(nodeId, rec); callbacks.onDone(nodeId, rec)
      markOut(nodeId, () => true)
    } else if (node.kind === 'subchain') {
      const ref = chains.find(c => c.slug === node.subchain)
      if (!ref) {
        const rec = controlOutput(nodeId, `subchain: ${node.subchain ?? '?'} (missing)`, '', 'error')
        nodeOutputs.set(nodeId, rec); emit(nodeId, rec); callbacks.onDone(nodeId, rec)
      } else {
        callbacks.onStart(nodeId, ref.name)
        // inject each *wired* declared input value into the matching inner seed
        // node; unwired inputs are skipped so the inner seed keeps its default.
        const innerStart: AgentOutput[] = (ref.inputs ?? [])
          .filter(p => liveEdgeForSlot(nodeId, p.name) !== undefined)
          .map(p => controlOutput(p.node, p.name, slotValue(nodeId, p.name), 'success'))
        // Every warning raised in here predates this node's own record, so none of
        // them can report until that record exists (#40).
        const deferredWarnings: SectionWarning[] = []
        const innerResults = await runChainGraph(
          ref, defs,
          {
            onStart: () => {}, onToken: () => {}, onDone: () => {},
            onWarning: w => deferredWarnings.push({ ...w, fromNode: nodeId, viaNode: w.viaNode ?? w.fromNode }),
          },
          { ...request, replay: innerStart, depth: depth + 1 },
        )
        // map each declared output to per-socket storage on this node
        const byNode = new Map<string, AgentOutput>()
        for (const r of innerResults) if (r.nodeId) byNode.set(r.nodeId, r)
        const innerById = new Map(ref.nodes.map(n => [n.id, n]))
        const outMap = new Map<string, string>()
        for (const p of ref.outputs ?? []) {
          const inner = innerById.get(p.node)
          if (!inner) { outMap.set(p.name, ''); continue }
          const read = readSocket(inner, p.socket ?? 'output', byNode, seedPrompt, readContext, paramValue)
          // A skipped inner node produced no answer, so its missing heading is not a
          // convention violation — only a real answer can violate one (#40).
          if (byNode.get(p.node)?.status === 'success') {
            emitSectionWarnings(read, nodeId, nodeId, p.name, w => deferredWarnings.push(w), p.node)
          }
          outMap.set(p.name, read.value)
        }
        setStateSockets(nodeId, outMap)   // stores outputKey(nodeId, name) records
        const statusRec = controlOutput(nodeId, ref.name, '', 'success')
        nodeOutputs.set(nodeId, statusRec)
        deferredWarnings.forEach(reportWarning)
        emit(nodeId, statusRec); callbacks.onDone(nodeId, statusRec)
        markOut(nodeId, () => true)
      }
    } else if (node.kind === 'hold') {
      // An answered hold never gets here: it is replayed from startOutputs above.
      // Out-edges stay dead; nothing is recorded until the human answers.
      held = true
      const inEdge = liveEdgeForSlot(nodeId, 'in')
      const { record, warning } = openHold(nodeId, inValue(nodeId), {
        prompt: node.prompt,
        fromNode: inEdge === undefined ? undefined : chain.edges[inEdge].fromNode,
      })
      if (warning) reportWarning(warning)
      callbacks.onHold?.(record)
    } else if (node.kind === 'loop-start' || node.kind === 'loop-end') {
      // Loop boundaries are consumed by runZone/zonesByStart above; one only reaches
      // here if it carries no registered zone (a malformed chain). No-op — its
      // out-edges stay dead, matching the prior silent fall-through.
    } else {
      // Every reachable kind is handled above. This makes a new ChainNode kind a
      // compile error here until it gets a dispatch arm (see docs/adding-a-node-kind.md).
      const _exhaustive: never = node
      void _exhaustive
    }
  }

  // A zone with no registered start/end pair stays a set of plain nodes.
  const unitOf = (nodeId: string): string => {
    const n = nodeById.get(nodeId)
    if (!n?.zone) return nodeId
    for (const [startId, z] of zonesByStart) if (z.id === n.zone) return startId
    return nodeId
  }
  const allUnits = new Set(chain.nodes.map(n => unitOf(n.id)))
  const unitDeps = new Map<string, Set<string>>([...allUnits].map(u => [u, new Set<string>()]))
  for (const e of chain.edges) {
    const from = unitOf(e.fromNode), to = unitOf(e.toNode)
    if (from !== to) unitDeps.get(to)?.add(from)
  }

  const topoRank = new Map(topoOrder(chain).map((id, i) => [id, i]))
  const doneUnits = new Set<string>()
  const MAX_CONCURRENCY = Number(process.env.CHAIN_MAX_CONCURRENCY) || 4

  const processUnit = async (unitId: string): Promise<void> => {
    const zone = zonesByStart.get(unitId)
    if (zone) await processZoneUnit(zone)
    else await processMainNode(unitId)
  }

  while (doneUnits.size < allUnits.size) {
    const ready = [...allUnits]
      .filter(u => !doneUnits.has(u) && [...unitDeps.get(u)!].every(d => doneUnits.has(d)))
      .sort((a, b) => (topoRank.get(a) ?? 0) - (topoRank.get(b) ?? 0))
    if (ready.length === 0) break // a DAG always has a ready unit; guards a malformed graph
    for (let i = 0; i < ready.length; i += MAX_CONCURRENCY) {
      // allSettled, not all: one node erroring must not abandon its wave-mates.
      await Promise.allSettled(ready.slice(i, i + MAX_CONCURRENCY).map(processUnit))
    }
    for (const u of ready) doneUnits.add(u)
    if (held) break // a held unit's descendants must never reach `ready` (#93)
  }

  const results: AgentOutput[] = []
  const flushed = new Set<string>()
  for (const id of topoOrder(chain)) {
    if (flushed.has(id)) continue
    flushed.add(id)
    const bucket = buckets.get(id)
    if (bucket) results.push(...bucket)
  }
  for (const [id, bucket] of buckets) if (!flushed.has(id)) results.push(...bucket)
  return results
}
