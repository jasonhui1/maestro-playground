import { ChainDef, ChainNode, ChainEdge, TemplateDef } from '../types'

function toSlug(name: string): string {
  return name.toLowerCase().trim().replace(/\s+/g, '-').replace(/[^\w.-]/g, '')
}

export interface ForkedChain {
  slug: string
  name: string
  description: string
  nodes: ChainNode[]
  edges: ChainEdge[]
}

// Build the data for a new chain by deep-copying the template's referenced chain graph.
// If the template has no resolvable chain ref, produce an empty chain.
export function buildChainFromTemplate(
  template: TemplateDef,
  newName: string,
  chains: ChainDef[],
): ForkedChain {
  const ref = template.chain ? chains.find(c => c.slug === template.chain) : undefined
  return {
    slug: toSlug(newName),
    name: newName,
    description: ref ? `Forked from template "${template.name}"` : `A new chain named ${newName}`,
    nodes: ref ? ref.nodes.map(n => structuredClone(n)) : [],
    edges: ref ? ref.edges.map(e => ({ ...e })) : [],
  }
}
