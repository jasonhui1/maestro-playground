import matter from 'gray-matter'
import { ChainDef, ChainNode, ChainEdge, ChainPort } from './types'
import { allFields, FieldCodec } from './nodeKinds'

export function parseEndpoint(s: string): { node: string; socket: string } {
  const str = String(s)
  const dot = str.indexOf('.')
  if (dot === -1) return { node: str.trim(), socket: 'output' }
  return { node: str.slice(0, dot).trim(), socket: str.slice(dot + 1).trim() }
}

function coerceField(raw: unknown, codec: FieldCodec): unknown {
  switch (codec) {
    case 'string':
      return raw as string | undefined
    case 'number':
      return typeof raw === 'number' ? raw : undefined
    case 'stringList':
      return Array.isArray(raw) ? (raw as unknown[]).map(String) : undefined
    case 'cases':
      return Array.isArray(raw)
        ? (raw as Record<string, unknown>[]).map(c => ({ label: String(c.label), condition: String(c.condition) }))
        : undefined
  }
}

export function parseChainContent(raw: string, slug: string): ChainDef {
  const { data } = matter(raw)
  const nodes: ChainNode[] = Array.isArray(data.nodes)
    ? data.nodes.map((n: Record<string, unknown>) => {
        const node: Record<string, unknown> = {
          id: String(n.id),
          kind: n.kind as ChainNode['kind'],
          pos: Array.isArray(n.pos) ? [Number(n.pos[0]), Number(n.pos[1])] as [number, number] : undefined,
          zone: n.zone as string | undefined,
        }
        for (const f of allFields) node[f.key] = coerceField(n[f.key], f.codec)
        return node as unknown as ChainNode
      })
    : []
  const edges: ChainEdge[] = Array.isArray(data.edges)
    ? data.edges.map((e: Record<string, unknown>) => {
        const from = parseEndpoint(e.from as string)
        const to = parseEndpoint(e.to as string)
        return { fromNode: from.node, fromSocket: from.socket, toNode: to.node, toSocket: to.socket }
      })
    : []
  const ports = (key: 'inputs' | 'outputs'): ChainPort[] | undefined =>
    Array.isArray(data[key])
      ? (data[key] as Record<string, unknown>[]).map(p => ({
          name: String(p.name), node: String(p.node),
          ...(p.socket !== undefined ? { socket: String(p.socket) } : {}),
        }))
      : undefined

  return { slug, name: data.name, description: data.description ?? '', nodes, edges, filePath: '', isFavorite: false, inputs: ports('inputs'), outputs: ports('outputs') }
}
