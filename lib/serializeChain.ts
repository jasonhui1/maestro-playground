import matter from 'gray-matter'
import { ChainNode, ChainEdge, ChainPort, BranchCase } from './types'
import { kindOf, FieldCodec } from './nodeKinds'

function serializeFieldValue(value: unknown, codec: FieldCodec): unknown {
  if (value === undefined) return undefined
  if (codec === 'cases') return (value as BranchCase[]).map(c => ({ label: c.label, condition: c.condition }))
  return value
}

function serializeNode(n: ChainNode): Record<string, unknown> {
  const out: Record<string, unknown> = { id: n.id, kind: n.kind }
  if (n.pos) out.pos = n.pos
  if (n.zone !== undefined) out.zone = n.zone
  for (const f of kindOf(n.kind).fields) {
    const value = serializeFieldValue((n as unknown as Record<string, unknown>)[f.key], f.codec)
    if (value !== undefined) out[f.key] = value
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
