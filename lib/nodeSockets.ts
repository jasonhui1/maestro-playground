import { ChainDef, ChainNode, AgentDef } from './types'
import { parseSlots } from './slots'
import { slugify } from './graph'

function zoneStateOf(node: ChainNode, chain: ChainDef): string[] {
  if (!node.zone) return []
  const start = chain.nodes.find(n => n.kind === 'loop-start' && n.zone === node.zone)
  return start?.state ?? []
}

export function inputSocketsOf(node: ChainNode, chain: ChainDef, agents: AgentDef[], chains: ChainDef[] = []): string[] {
  if (node.kind === 'subchain') {
    const ref = chains.find(c => c.slug === node.subchain)
    return (ref?.inputs ?? []).map(p => p.name)
  }
  if (node.kind === 'agent' || node.kind === 'decider') {
    const a = node.agent ? agents.find(x => x.slug === node.agent) : undefined
    return a ? parseSlots(a.systemPrompt) : []
  }
  if (node.kind === 'gate' || node.kind === 'branch') return ['in']
  if (node.kind === 'loop-start' || node.kind === 'loop-end') return zoneStateOf(node, chain)
  return []
}

export function outputSocketsOf(node: ChainNode, chain: ChainDef, agents: AgentDef[], chains: ChainDef[] = []): string[] {
  if (node.kind === 'subchain') {
    const ref = chains.find(c => c.slug === node.subchain)
    const outs = (ref?.outputs ?? []).map(p => p.name)
    return outs.length ? outs : ['output']
  }
  if (node.kind === 'seed' || node.kind === 'context') return ['output']
  if (node.kind === 'gate') return ['output']
  if (node.kind === 'branch') return [...(node.cases ?? []).map(c => c.label), ...(node.default ? [node.default] : [])]
  if (node.kind === 'loop-start' || node.kind === 'loop-end') return zoneStateOf(node, chain)
  const a = node.agent ? agents.find(x => x.slug === node.agent) : undefined
  const sockets = ['output', ...(a?.outputs ?? []).map(s => slugify(s.name))]
  return Array.from(new Set(sockets))
}
