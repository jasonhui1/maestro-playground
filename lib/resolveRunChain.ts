import { AgentDef, ChainDef, ChainNode, ChainEdge } from './types'

export interface RunChainBody {
  chainName?: string
  agentName?: string
  chain?: { name?: string; description?: string; nodes: ChainNode[]; edges: ChainEdge[] }
  slug?: string
}

export type ResolvedRun =
  | { chain: ChainDef; title: string; kind: 'inline' | 'chain' | 'agent' }
  | { error: string; status: number }

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
    const found = ws.chains.find(c => c.name === body.chainName) || ws.chains.find(c => c.slug === body.chainName)
    if (!found) return { error: 'Chain not found', status: 404 }
    return { kind: 'chain', title: found.name, chain: found }
  }
  if (body.agentName) {
    const agent = ws.agents.find(a => a.name === body.agentName) || ws.agents.find(a => a.slug === body.agentName)
    if (!agent) return { error: 'Agent not found', status: 404 }
    return {
      kind: 'agent', title: agent.name,
      chain: {
        slug: agent.slug, name: agent.name, description: '', filePath: '',
        nodes: [{ id: 'seed', kind: 'seed' }, { id: agent.slug, kind: 'agent', agent: agent.slug }],
        edges: [{ fromNode: 'seed', fromSocket: 'output', toNode: agent.slug, toSocket: 'input' }],
      },
    }
  }
  return { error: 'No chain or agent specified', status: 400 }
}
