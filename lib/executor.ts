import fs from 'fs'
import path from 'path'
import matter from 'gray-matter'
import { ChainDef, ChainNode, AgentDef, SkillDef, AgentOutput } from './types'
import { runAgent } from './runner'
import { injectSkills } from './prompt'
import { resolveNodePrompt, socketValue } from './resolveNode'
import { topoOrder } from './chainGraph'
import { evalCondition } from './condition'
import { parseSlots } from './slots'
import { slugify, extractSection } from './graph'

export interface RunCallbacks {
  onStart: (nodeId: string, agentName: string) => void
  onToken: (nodeId: string, token: string, type?: 'thought' | 'output') => void
  onDone: (nodeId: string, output: AgentOutput) => void
}

function makeContextReader(workspacePath: string) {
  return (file: string): string => {
    const p = path.join(workspacePath, 'context', `${file}.md`)
    if (!fs.existsSync(p)) return `[context ${file} not found]`
    const { content } = matter(fs.readFileSync(p, 'utf-8'))
    return content.trim()
  }
}

function controlOutput(nodeId: string, label: string, output: string, status: AgentOutput['status']): AgentOutput {
  return { nodeId, agentName: label, systemPrompt: '', input: '', output,
    tokensIn: 0, tokensOut: 0, costUsd: 0, latencyMs: 0, model: '', timestamp: new Date().toISOString(), status }
}

export async function runChainGraph(
  chain: ChainDef,
  agents: AgentDef[],
  skills: SkillDef[],
  seedPrompt: string,
  workspacePath: string,
  callbacks: RunCallbacks,
  runFn: typeof runAgent = runAgent,
  startOutputs: AgentOutput[] = [],
  chains: ChainDef[] = [],
  depth = 0,
): Promise<AgentOutput[]> {
  const MAX_SUBCHAIN_DEPTH = 10
  if (depth > MAX_SUBCHAIN_DEPTH) throw new Error('subchain recursion too deep')
  const agentBySlug = new Map(agents.map(a => [a.slug, a]))
  const nodeById = new Map(chain.nodes.map(n => [n.id, n]))
  const readContext = makeContextReader(workspacePath)

  const nodeOutputs = new Map<string, AgentOutput>()
  const results: AgentOutput[] = []

  // Result ordering is decoupled from execution order: records are filed into a
  // per-anchor bucket and flushed in topoOrder at the end (see anchor rules in
  // the A1 task). `results` stays as a live push target for code paths that don't
  // care about ordering yet; the RETURNED array is rebuilt from buckets.
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

  const usedSlots = (node: ChainNode): string[] => {
    if (node.kind === 'agent' || node.kind === 'decider') {
      const a = node.agent ? agentBySlug.get(node.agent) : undefined
      return a ? parseSlots(a.systemPrompt) : []
    }
    if (node.kind === 'gate' || node.kind === 'branch' || node.kind === 'report' || node.kind === 'join') return ['in']
    if (node.kind === 'subchain') {
      // Only declared inputs the host actually wired gate the node; unwired
      // inputs are intentionally left unset (the inner seed falls back to the
      // seed prompt) rather than skipping the whole subchain.
      const ref = chains.find(c => c.slug === node.subchain)
      const wired = new Set((incomingByNode.get(node.id) ?? []).map(i => chain.edges[i].toSocket))
      return (ref?.inputs ?? []).map(p => p.name).filter(name => wired.has(name))
    }
    return []
  }
  const slotValue = (nodeId: string, slot: string): string => {
    const idx = liveEdgeForSlot(nodeId, slot)
    if (idx === undefined) return ''
    const e = chain.edges[idx]
    const src = nodeById.get(e.fromNode)
    return src ? socketValue(src, e.fromSocket, nodeOutputs, seedPrompt, readContext) : ''
  }
  const inValue = (nodeId: string): string => slotValue(nodeId, 'in')

  const runAgentNode = async (node: ChainNode, agent: AgentDef, round?: number, anchorId: string = node.id): Promise<AgentOutput> => {
    callbacks.onStart(node.id, agent.name)
    const body = resolveNodePrompt(node, chain, agent, nodeOutputs, seedPrompt, readContext)
    const systemPrompt = injectSkills(agent, skills, body)
    const output = await runFn(agent, systemPrompt, 'Follow your instructions.', (t, ty) => callbacks.onToken(node.id, t, ty))
    output.nodeId = node.id
    if (round !== undefined) output.round = round
    nodeOutputs.set(node.id, output); emit(anchorId, output); callbacks.onDone(node.id, output)
    return output
  }

  // --- zones ---
  interface Zone { id: string; startId: string; endId: string; bodyIds: string[]; stateNames: string[]; until: string; maxIterations: number }
  const zonesByStart = new Map<string, Zone>()
  const handledByZone = new Set<string>()
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
        stateNames: start.state || [], until: end.until || '', maxIterations: end.maxIterations || 1,
      })
    }
  }

  const edgeVal = (e: typeof chain.edges[number]): string => {
    const src = nodeById.get(e.fromNode)
    return src ? socketValue(src, e.fromSocket, nodeOutputs, seedPrompt, readContext) : ''
  }
  const joinLabel = (e: typeof chain.edges[number]): string => {
    const src = nodeById.get(e.fromNode)
    const a = src?.agent ? agentBySlug.get(src.agent) : undefined
    const base = a?.name ?? src?.agent ?? src?.id ?? e.fromNode
    return slugify(e.fromSocket) === 'output' ? base : `${base} (${e.fromSocket})`
  }
  const setStateSockets = (nodeId: string, state: Map<string, string>, anchorId: string = nodeId) => {
    for (const [name, val] of state) {
      const rec = controlOutput(`${nodeId}::${name}`, nodeId, val, 'success')
      nodeOutputs.set(`${nodeId}::${slugify(name)}`, rec)
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
    handledByZone.add(zone.startId); handledByZone.add(zone.endId); zone.bodyIds.forEach(id => handledByZone.add(id))
    const incoming = (id: string) => incomingByNode.get(id) || []
    // initial state
    const state = new Map<string, string>()
    for (const name of zone.stateNames) {
      const idx = incoming(zone.startId).find(i => chain.edges[i].toSocket === name)
      state.set(name, idx !== undefined ? edgeVal(chain.edges[idx]) : '')
    }
    const order = bodyOrder(zone)
    let finalState = state
    for (let round = 0; round < zone.maxIterations; round++) {
      setStateSockets(zone.startId, state, zone.startId)
      for (const id of order) {
        const bn = nodeById.get(id)!
        if (bn.kind === 'agent' || bn.kind === 'decider') {
          const a = bn.agent ? agentBySlug.get(bn.agent) : undefined
          if (a) {
            const replayed = startOutputs.find(o => o.nodeId === bn.id && o.round === round)
            if (replayed) {
              nodeOutputs.set(bn.id, replayed)
            } else {
              await runAgentNode(bn, a, round, zone.startId)
            }
          }
        }
      }
      const newState = new Map<string, string>()
      for (const name of zone.stateNames) {
        const idx = incoming(zone.endId).find(i => chain.edges[i].toSocket === name)
        newState.set(name, idx !== undefined ? edgeVal(chain.edges[idx]) : (state.get(name) || ''))
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

  for (const nodeId of topoOrder(chain)) {
    if (handledByZone.has(nodeId)) continue
    const startZone = zonesByStart.get(nodeId)
    if (startZone) {
      if (nodeOutputs.has(startZone.endId)) {
        handledByZone.add(startZone.startId)
        handledByZone.add(startZone.endId)
        startZone.bodyIds.forEach(id => handledByZone.add(id))
        markOut(startZone.endId, () => true)
        continue
      }
      const inc = incomingByNode.get(nodeId) || []
      const anyLive = inc.length === 0 || inc.some(i => live.has(i))
      if (anyLive) { await runZone(startZone); continue }
      // zone is unreachable (blocked upstream): record members skipped
      for (const id of [startZone.startId, ...startZone.bodyIds, startZone.endId]) {
        handledByZone.add(id)
        const subNode = nodeById.get(id)
        const label = subNode ? (subNode.agent || subNode.kind) : 'node'
        const rec = controlOutput(id, label, '', 'skipped')
        nodeOutputs.set(id, rec); emit(startZone.startId, rec); callbacks.onDone(id, rec)
      }
      continue
    }

    const node = nodeById.get(nodeId)
    if (!node || nodeOutputs.has(nodeId)) { if (node) markOut(nodeId, () => true); continue }

    if (node.kind === 'seed' || node.kind === 'context') { markOut(nodeId, () => true); continue }

    const slots = usedSlots(node)
    const available = slots.every(s => liveEdgeForSlot(nodeId, s) !== undefined)
    if (!available) {
      const rec = controlOutput(nodeId, node.agent || node.kind, '', 'skipped')
      nodeOutputs.set(nodeId, rec); emit(nodeId, rec); callbacks.onDone(nodeId, rec)
      continue // out-edges remain dead
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
      if (active) markOut(nodeId, e => slugify(e.fromSocket) === slugify(active))
    } else if (node.kind === 'report') {
      const rec = controlOutput(nodeId, 'report', inValue(nodeId), 'success')
      nodeOutputs.set(nodeId, rec); emit(nodeId, rec); callbacks.onDone(nodeId, rec)
      markOut(nodeId, () => true)
    } else if (node.kind === 'join') {
      const liveIn = (incomingByNode.get(nodeId) || []).filter(i => live.has(i))
      const blocks = liveIn.map(i => {
        const e = chain.edges[i]
        return `## ${joinLabel(e)}\n${edgeVal(e)}`
      })
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
        const innerResults = await runChainGraph(
          ref, agents, skills, seedPrompt, workspacePath,
          { onStart: () => {}, onToken: () => {}, onDone: () => {} },
          runFn, innerStart, chains, depth + 1,
        )
        // map each declared output to per-socket storage on this node
        const byNode = new Map<string, AgentOutput>()
        for (const r of innerResults) if (r.nodeId) byNode.set(r.nodeId, r)
        const outMap = new Map<string, string>()
        for (const p of ref.outputs ?? []) {
          const r = byNode.get(p.node)
          const val = r ? (slugify(p.socket ?? 'output') === 'output' ? r.output : extractSection(r.output, p.socket!)) : ''
          outMap.set(p.name, val)
        }
        setStateSockets(nodeId, outMap)   // stores `${nodeId}::${slug(name)}` records + emits (anchor: nodeId)
        const statusRec = controlOutput(nodeId, ref.name, '', 'success')
        nodeOutputs.set(nodeId, statusRec); emit(nodeId, statusRec); callbacks.onDone(nodeId, statusRec)
        markOut(nodeId, () => true)
      }
    }
  }
  const finalResults: AgentOutput[] = []
  const emitted = new Set<string>()
  for (const id of topoOrder(chain)) {
    if (emitted.has(id)) continue
    const b = buckets.get(id)
    if (b) finalResults.push(...b)
    emitted.add(id)
  }
  // safety: any anchor not present in topoOrder (should not happen) appended last
  for (const [id, b] of buckets) if (!emitted.has(id)) finalResults.push(...b)
  return finalResults
}
