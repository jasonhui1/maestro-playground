import { ChainDef, ChainNode, AgentDef, AgentOutput } from './types'
import { parseSlots } from './slots'
import { extractSection, slugify } from './graph'

// Resolves the value carried on a source node's socket.
// seed -> seed prompt; context -> file; gate/branch -> their pass-through output
// (socket ignored); agent/decider -> output (full) or a named section.
export function socketValue(
  src: ChainNode,
  socket: string,
  nodeOutputs: Map<string, AgentOutput>,
  seedPrompt: string,
  readContext: (file: string) => string,
): string {
  if (src.kind === 'seed') return seedPrompt
  if (src.kind === 'context') return readContext(src.file || '')
  if (src.kind === 'loop-start' || src.kind === 'loop-end') {
    const o = nodeOutputs.get(`${src.id}::${slugify(socket)}`)
    return o ? o.output : ''
  }
  if (src.kind === 'gate' || src.kind === 'branch') {
    const o = nodeOutputs.get(src.id)
    return o ? o.output : ''
  }
  const o = nodeOutputs.get(src.id)
  if (!o) return ''
  return slugify(socket) === 'output' ? o.output : extractSection(o.output, socket)
}

export function resolveNodePrompt(
  node: ChainNode,
  chain: ChainDef,
  agent: AgentDef,
  nodeOutputs: Map<string, AgentOutput>,
  seedPrompt: string,
  readContext: (file: string) => string,
): string {
  let out = agent.systemPrompt
  for (const slot of parseSlots(agent.systemPrompt)) {
    const edge = chain.edges.find(e => e.toNode === node.id && e.toSocket === slot)
    let value: string
    if (!edge) {
      value = `[${slot}: not wired]`
    } else {
      const src = chain.nodes.find(n => n.id === edge.fromNode)
      value = src
        ? socketValue(src, edge.fromSocket, nodeOutputs, seedPrompt, readContext)
        : `[${slot}: source "${edge.fromNode}" missing]`
    }
    const re = new RegExp(`\\{\\s*${slot}\\s*\\}`, 'g')
    out = out.replace(re, value)
  }
  return out
}
