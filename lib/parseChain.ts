import matter from 'gray-matter'
import { ChainDef, ChainNode, ChainEdge, ChainPort, ChainParameter } from './types'
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
          ...(p.role === 'join' ? { role: 'join' as const } : {}),
        }))
      : undefined

  const parameter: ChainParameter | undefined =
    data.parameter && typeof data.parameter === 'object'
      ? {
          name: String((data.parameter as Record<string, unknown>).name),
          options: Array.isArray((data.parameter as Record<string, unknown>).options)
            ? ((data.parameter as Record<string, unknown>).options as unknown[]).map(String)
            : [],
          node: String((data.parameter as Record<string, unknown>).node),
        }
      : undefined

  // A file with no `name:` is named by its slug — an undefined name reaches the YAML
  // dumper on the next edit and throws (js-yaml cannot represent undefined).
  const purpose = data.purpose === 'insight' || data.purpose === 'production' || data.purpose === 'stress-test'
    ? data.purpose
    : undefined

  return { slug, name: data.name ?? slug, description: data.description ?? '', nodes, edges, filePath: '', isFavorite: false, inputs: ports('inputs'), outputs: ports('outputs'), view: data.view ? String(data.view) : undefined, moment: data.moment ? String(data.moment) : undefined, purpose, parameter }
}
