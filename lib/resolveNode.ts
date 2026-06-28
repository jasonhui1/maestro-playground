import { ChainDef, ChainNode, AgentDef, AgentOutput } from './types'
import { parseSlots } from './slots'
import { extractSection, slugify } from './graph'

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
      if (!src) value = `[${slot}: source "${edge.fromNode}" missing]`
      else if (src.kind === 'seed') value = seedPrompt
      else if (src.kind === 'context') value = readContext(src.file || '')
      else {
        const o = nodeOutputs.get(src.id)
        if (!o) value = `[${slot}: ${src.id} not run]`
        else {
          const sock = slugify(edge.fromSocket)
          value = sock === 'output' ? o.output : extractSection(o.output, edge.fromSocket)
        }
      }
    }
    const re = new RegExp(`\\{\\s*${slot}\\s*\\}`, 'g')
    out = out.replace(re, value)
  }
  return out
}
