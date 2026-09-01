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

// YAML has no representation of `undefined`, and js-yaml throws rather than skipping it —
// one undefined anywhere in the tree aborts the whole dump, which in the editor surfaces
// as a crash on a keystroke. An absent optional field is what `undefined` means here, so
// drop those keys instead.
function omitUndefined<T>(value: T): T {
  if (Array.isArray(value)) return value.map(omitUndefined) as unknown as T
  if (value === null || typeof value !== 'object') return value
  const out: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    if (v !== undefined) out[k] = omitUndefined(v)
  }
  return out as T
}

export function chainToData(
  meta: { name: string; description?: string; inputs?: ChainPort[]; outputs?: ChainPort[]; view?: string },
  nodes: ChainNode[],
  edges: ChainEdge[],
): Record<string, unknown> {
  const data: Record<string, unknown> = {
    name: meta.name ?? '',
    description: meta.description ?? '',
    nodes: nodes.map(serializeNode),
    edges: edges.map(serializeEdge),
  }
  if (meta.inputs && meta.inputs.length) data.inputs = meta.inputs
  if (meta.outputs && meta.outputs.length) data.outputs = meta.outputs
  if (meta.view) data.view = meta.view
  return omitUndefined(data)
}

export function serializeChain(
  meta: { name: string; description?: string; inputs?: ChainPort[]; outputs?: ChainPort[]; view?: string },
  nodes: ChainNode[],
  edges: ChainEdge[],
): string {
  return matter.stringify('', chainToData(meta, nodes, edges))
}
