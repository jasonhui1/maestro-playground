import matter from 'gray-matter'
import { ChainNode, ChainEdge } from './types'

function serializeNode(n: ChainNode): Record<string, unknown> {
  const out: Record<string, unknown> = { id: n.id, kind: n.kind }
  if (n.pos) out.pos = n.pos
  if (n.zone !== undefined) out.zone = n.zone
  switch (n.kind) {
    case 'agent':
    case 'decider':
      if (n.agent !== undefined) out.agent = n.agent
      break
    case 'context':
      if (n.file !== undefined) out.file = n.file
      break
    case 'gate':
      if (n.condition !== undefined) out.condition = n.condition
      break
    case 'branch':
      if (n.cases) out.cases = n.cases.map(c => ({ label: c.label, condition: c.condition }))
      if (n.default !== undefined) out.default = n.default
      break
    case 'loop-start':
      if (n.state) out.state = n.state
      break
    case 'loop-end':
      if (n.until !== undefined) out.until = n.until
      if (n.maxIterations !== undefined) out.maxIterations = n.maxIterations
      break
  }
  return out
}

function serializeEdge(e: ChainEdge): { from: string; to: string } {
  const from = e.fromSocket === 'output' ? e.fromNode : `${e.fromNode}.${e.fromSocket}`
  const to = `${e.toNode}.${e.toSocket}`
  return { from, to }
}

export function serializeChain(
  meta: { name: string; description?: string },
  nodes: ChainNode[],
  edges: ChainEdge[],
): string {
  const data = {
    name: meta.name,
    description: meta.description ?? '',
    nodes: nodes.map(serializeNode),
    edges: edges.map(serializeEdge),
  }
  return matter.stringify('', data)
}
