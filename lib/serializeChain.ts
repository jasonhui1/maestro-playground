import matter from 'gray-matter'
import { ChainNode, ChainEdge, ChainPort } from './types'
import { kindOf } from './nodeKinds'

function serializeNode(n: ChainNode): Record<string, unknown> {
  const out: Record<string, unknown> = { id: n.id, kind: n.kind }
  if (n.pos) out.pos = n.pos
  if (n.zone !== undefined) out.zone = n.zone

  const descriptor = kindOf(n.kind)
  if (descriptor) {
    for (const field of descriptor.fields) {
      const val = (n as Record<string, any>)[field.key]
      if (val !== undefined) {
        if (field.codec === 'cases') {
          if (val) {
            out[field.key] = val.map((c: any) => ({ label: c.label, condition: c.condition }))
          }
        } else {
          out[field.key] = val
        }
      }
    }
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
