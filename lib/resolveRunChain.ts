import { AgentDef, ChainDef, ChainNode, ChainEdge, Refusal, RunMeta } from './types'
import { badRequest, notFound } from './refusal'
import { promptSlots } from './tokens'

export interface RunChainBody {
  chainName?: string
  agentName?: string
  chain?: { name?: string; description?: string; nodes: ChainNode[]; edges: ChainEdge[] }
  slug?: string
}

export type ResolvedRunKind = 'inline' | 'chain' | 'agent'

export type ResolvedRun =
  | { chain: ChainDef; title: string; kind: ResolvedRunKind }
  | Refusal

/** A run's chain by name, falling back to slug — the lookup a run's chainName is resolved by. */
export function findChainForRun(chains: ChainDef[], chainName: string): ChainDef | undefined {
  return chains.find(c => c.name === chainName) || chains.find(c => c.slug === chainName)
}

export function resolveRunChain(
  body: RunChainBody,
  ws: { agents: AgentDef[]; chains: ChainDef[] },
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
    const found = findChainForRun(ws.chains, body.chainName)
    if (!found) return notFound('Chain not found')
    return { kind: 'chain', title: found.name, chain: found }
  }
  if (body.agentName) {
    const agent = ws.agents.find(a => a.name === body.agentName) || ws.agents.find(a => a.slug === body.agentName)
    if (!agent) return notFound('Agent not found')
    return { kind: 'agent', title: agent.name, chain: agentChain(agent) }
  }
  return badRequest('No chain or agent specified')
}

/** An agent alone: one seed per prompt slot, each an input named after it; `{input}`, or no slot at all, reads the default `seed` (#152). */
function agentChain(agent: AgentDef): ChainDef {
  const slots = promptSlots(agent.systemPrompt)
  const seeds = (slots.length ? slots : ['input']).map(slot => ({ slot, id: slot === 'input' ? 'seed' : `${slot}-seed` }))
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
  const live = findChainForRun(chains, meta.chainName)
  const base: ChainDef = live ?? { slug: 'inline', name: meta.chainName, description: '', nodes: [], edges: [], filePath: '' }
  const { nodes, edges, inputs } = meta.graph
  return { ...base, nodes, edges, ...(inputs ? { inputs } : {}) }
}
