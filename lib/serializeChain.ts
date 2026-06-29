import matter from 'gray-matter'
import { ChainNode, ChainEdge, ChainPort } from './types'

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
    case 'subchain':
      if (n.subchain !== undefined) out.subchain = n.subchain
      break
  }
  return out
}

function serializeEdge(e: ChainEdge): { from: string; to: string } {
  const from = e.fromSocket === 'output' ? e.fromNode : `${e.fromNode}.${e.fromSocket}`
  const to = `${e.toNode}.${e.toSocket}`
  return { from, to }
}

export function chainToData(
  meta: { name: string; description?: string; inputs?: ChainPort[]; outputs?: ChainPort[] },
  nodes: ChainNode[],
  edges: ChainEdge[],
): Record<string, unknown> {
  const data: Record<string, unknown> = {
    name: meta.name,
    description: meta.description ?? '',
    nodes: nodes.map(serializeNode),
    edges: edges.map(serializeEdge),
  }
  if (meta.inputs && meta.inputs.length) data.inputs = meta.inputs
  if (meta.outputs && meta.outputs.length) data.outputs = meta.outputs
  return data
}

export function serializeChain(
  meta: { name: string; description?: string; inputs?: ChainPort[]; outputs?: ChainPort[] },
  nodes: ChainNode[],
  edges: ChainEdge[],
): string {
  return matter.stringify('', chainToData(meta, nodes, edges))
}
