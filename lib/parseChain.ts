import matter from 'gray-matter'
import { ChainDef, ChainNode, ChainEdge, ChainPort } from './types'
import { kindOf } from './nodeKinds'

export function parseEndpoint(s: string): { node: string; socket: string } {
  const str = String(s)
  const dot = str.indexOf('.')
  if (dot === -1) return { node: str.trim(), socket: 'output' }
  return { node: str.slice(0, dot).trim(), socket: str.slice(dot + 1).trim() }
}

export function parseChainContent(raw: string, slug: string): ChainDef {
  const { data } = matter(raw)
  const nodes: ChainNode[] = Array.isArray(data.nodes)
    ? data.nodes.map((n: Record<string, unknown>) => {
        const node: Record<string, any> = {
          id: String(n.id),
          kind: n.kind as ChainNode['kind'],
          agent: undefined,
          file: undefined,
          pos: Array.isArray(n.pos) ? [Number(n.pos[0]), Number(n.pos[1])] as [number, number] : undefined,
          condition: undefined,
          cases: undefined,
          default: undefined,
          zone: n.zone as string | undefined,
          state: undefined,
          until: undefined,
          maxIterations: undefined,
          subchain: undefined,
        }

        const descriptor = kindOf(node.kind)
        if (descriptor) {
          for (const field of descriptor.fields) {
            const rawVal = n[field.key]
            if (rawVal === undefined) {
              continue
            }
            switch (field.codec) {
              case 'string':
                node[field.key] = String(rawVal)
                break
              case 'number':
                node[field.key] = typeof rawVal === 'number' ? rawVal : undefined
                break
              case 'stringList':
                node[field.key] = Array.isArray(rawVal) ? rawVal.map(String) : undefined
                break
              case 'cases':
                node[field.key] = Array.isArray(rawVal)
                  ? rawVal.map((c: any) => ({ label: String(c.label), condition: String(c.condition) }))
                  : undefined
                break
            }
          }
        }
        return node as ChainNode
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
