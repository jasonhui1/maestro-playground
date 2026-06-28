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
import { slugify } from './graph'

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
): Promise<AgentOutput[]> {
  const agentBySlug = new Map(agents.map(a => [a.slug, a]))
  const nodeById = new Map(chain.nodes.map(n => [n.id, n]))
  const readContext = makeContextReader(workspacePath)

  const nodeOutputs = new Map<string, AgentOutput>()
  const results: AgentOutput[] = []

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
    if (node.kind === 'gate' || node.kind === 'branch') return ['in']
    return []
  }
  const inValue = (nodeId: string): string => {
    const idx = liveEdgeForSlot(nodeId, 'in')
    if (idx === undefined) return ''
    const e = chain.edges[idx]
    const src = nodeById.get(e.fromNode)
    return src ? socketValue(src, e.fromSocket, nodeOutputs, seedPrompt, readContext) : ''
  }

  const runAgentNode = async (node: ChainNode, agent: AgentDef, round?: number): Promise<AgentOutput> => {
    callbacks.onStart(node.id, agent.name)
    const body = resolveNodePrompt(node, chain, agent, nodeOutputs, seedPrompt, readContext)
    const systemPrompt = injectSkills(agent, skills, body)
    const output = await runFn(agent, systemPrompt, 'Follow your instructions.', (t, ty) => callbacks.onToken(node.id, t, ty))
    output.nodeId = node.id
    if (round !== undefined) output.round = round
    nodeOutputs.set(node.id, output); results.push(output); callbacks.onDone(node.id, output)
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
  const setStateSockets = (nodeId: string, state: Map<string, string>) => {
    for (const [name, val] of state) {
      const rec = controlOutput(`${nodeId}::${name}`, nodeId, val, 'success')
      nodeOutputs.set(`${nodeId}::${slugify(name)}`, rec)
      results.push(rec)
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
      setStateSockets(zone.startId, state)
      for (const id of order) {
        const bn = nodeById.get(id)!
        if (bn.kind === 'agent' || bn.kind === 'decider') {
          const a = bn.agent ? agentBySlug.get(bn.agent) : undefined
          if (a) {
            const replayed = startOutputs.find(o => o.nodeId === bn.id && o.round === round)
            if (replayed) {
              nodeOutputs.set(bn.id, replayed)
            } else {
              await runAgentNode(bn, a, round)
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
    setStateSockets(zone.endId, finalState)
    const rec = controlOutput(zone.endId, 'loop-end', '', 'success')
    nodeOutputs.set(zone.endId, rec); results.push(rec); callbacks.onDone(zone.endId, rec)
    markOut(zone.endId, () => true)
  }

  // replay branched outputs (their out-edges are live)
  for (const o of startOutputs) {
    if (o.nodeId) { nodeOutputs.set(o.nodeId, o); markOut(o.nodeId, () => true) }
    results.push(o); callbacks.onDone(o.nodeId || '', o)
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
        nodeOutputs.set(id, rec); results.push(rec); callbacks.onDone(id, rec)
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
      nodeOutputs.set(nodeId, rec); results.push(rec); callbacks.onDone(nodeId, rec)
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
      nodeOutputs.set(nodeId, rec); results.push(rec); callbacks.onDone(nodeId, rec)
      if (pass) markOut(nodeId, () => true)
    } else if (node.kind === 'branch') {
      const active = (node.cases || []).find(c => evalCondition(c.condition, nodeOutputs))?.label ?? node.default
      const rec = controlOutput(nodeId, `branch: ${active ?? 'none'}`, inValue(nodeId), 'success')
      nodeOutputs.set(nodeId, rec); results.push(rec); callbacks.onDone(nodeId, rec)
      if (active) markOut(nodeId, e => slugify(e.fromSocket) === slugify(active))
    }
  }
  return results
}
