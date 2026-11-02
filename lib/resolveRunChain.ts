import { AgentDef, ChainDef, ChainNode, ChainEdge, Refusal, RunMeta, ToolDef } from './types'
import { badRequest, notFound } from './refusal'
import { agentSlots } from './tokens'
import { toolNodeInputs } from './tools/spec'
import { runChain } from './runIndex'

export interface RunChainBody {
  chainName?: string
  agentName?: string
  toolName?: string
  chain?: { name?: string; description?: string; nodes: ChainNode[]; edges: ChainEdge[] }
  slug?: string
}

export type ResolvedRunKind = 'inline' | 'chain' | 'agent' | 'tool'

export type ResolvedRun =
  | { chain: ChainDef; title: string; kind: ResolvedRunKind }
  | Refusal

/** A request names a chain by name, falling back to slug. */
function findChain(chains: ChainDef[], chainName: string): ChainDef | undefined {
  return chains.find(c => c.name === chainName) || chains.find(c => c.slug === chainName)
}

export function resolveRunChain(
  body: RunChainBody,
  ws: { agents: AgentDef[]; chains: ChainDef[]; tools?: ToolDef[] },
): ResolvedRun {
  if (body.chain) {
    const name = body.chain.name || 'Inline chain'
    return {
      kind: 'inline',
      title: name,
      chain: {
        slug: body.slug || 'inline', name, description: body.chain.description || '',
        nodes: body.chain.nodes, edges: body.chain.edges, filePath: '',
      },
    }
  }
  if (body.chainName) {
    const found = findChain(ws.chains, body.chainName)
    if (!found) return notFound('Chain not found')
    return { kind: 'chain', title: found.name, chain: found }
  }
  if (body.agentName) {
    const agent = ws.agents.find(a => a.name === body.agentName) || ws.agents.find(a => a.slug === body.agentName)
    if (!agent) return notFound('Agent not found')
    return { kind: 'agent', title: agent.name, chain: agentChain(agent) }
  }
  if (body.toolName) {
    const tool = ws.tools?.find(t => t.name === body.toolName) || ws.tools?.find(t => t.slug === body.toolName)
    if (!tool) return notFound('Tool not found')
    const inputs = toolNodeInputs(tool).map(name => ({ name, node: `${tool.slug}-${name}-seed` }))
    return {
      kind: 'tool', title: tool.name,
      chain: {
        slug: tool.slug, name: tool.name, description: '', filePath: '',
        nodes: [...inputs.map(p => ({ id: p.node, kind: 'seed' as const })), { id: tool.slug, kind: 'tool', tool: tool.name }],
        edges: inputs.map(p => ({ fromNode: p.node, fromSocket: 'output', toNode: tool.slug, toSocket: p.name })),
        inputs,
      },
    }
  }
  return badRequest('No chain, agent or tool specified')
}

/** An agent alone: one seed per prompt slot (#152); no slots means no seeds or edges (#156). */
function agentChain(agent: AgentDef): ChainDef {
  const slots = agentSlots(agent)
  const seeds = slots.map(slot => ({ slot, id: slot === 'input' ? 'seed' : `${slot}-seed` }))
  return {
    slug: agent.slug, name: agent.name, description: '', filePath: '',
    nodes: [...seeds.map(s => ({ id: s.id, kind: 'seed' as const })), { id: agent.slug, kind: 'agent', agent: agent.slug }],
    edges: seeds.map(s => ({ fromNode: s.id, fromSocket: 'output', toNode: agent.slug, toSocket: s.slot })),
    ...(slots.length ? { inputs: seeds.map(s => ({ name: s.slot, node: s.id })) } : {}),
  }
}

/**
 * The chain a resume continues: the graph and input ports the run started with, with the live
 * file's declared view and parameter when the chain still exists (#94).
 */
export function chainForResume(meta: RunMeta, chains: ChainDef[]): ChainDef | undefined {
  if (!meta.graph) return undefined
  const live = runChain(meta, chains)
  const base: ChainDef = live ?? { slug: 'inline', name: meta.chainName, description: '', nodes: [], edges: [], filePath: '' }
  const { nodes, edges, inputs } = meta.graph
  return { ...base, nodes, edges, ...(inputs ? { inputs } : {}) }
}
