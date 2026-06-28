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

  // replay branched outputs (their out-edges are live)
  for (const o of startOutputs) {
    if (o.nodeId) { nodeOutputs.set(o.nodeId, o); markOut(o.nodeId, () => true) }
    results.push(o); callbacks.onDone(o.nodeId || '', o)
  }

  for (const nodeId of topoOrder(chain)) {
    const node = nodeById.get(nodeId)
    if (!node || nodeOutputs.has(nodeId)) { if (node) markOut(nodeId, () => true); continue }

    if (node.kind === 'seed' || node.kind === 'context') { markOut(nodeId, () => true); continue }

    const slots = usedSlots(node)
    const available = slots.every(s => liveEdgeForSlot(nodeId, s) !== undefined)
    if (!available) {
      const rec = controlOutput(nodeId, node.kind, '', 'skipped')
      nodeOutputs.set(nodeId, rec); results.push(rec); callbacks.onDone(nodeId, rec)
      continue // out-edges remain dead
    }

    if (node.kind === 'agent' || node.kind === 'decider') {
      const agent = node.agent ? agentBySlug.get(node.agent) : undefined
      if (!agent) continue
      callbacks.onStart(nodeId, agent.name)
      const body = resolveNodePrompt(node, chain, agent, nodeOutputs, seedPrompt, readContext)
      const systemPrompt = injectSkills(agent, skills, body)
      const output = await runFn(agent, systemPrompt, 'Follow your instructions.', (t, ty) => callbacks.onToken(nodeId, t, ty))
      output.nodeId = nodeId
      nodeOutputs.set(nodeId, output); results.push(output); callbacks.onDone(nodeId, output)
      markOut(nodeId, () => true)
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
