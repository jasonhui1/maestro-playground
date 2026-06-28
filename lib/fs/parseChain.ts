import matter from 'gray-matter'
import fs from 'fs'
import path from 'path'
import { ChainDef, ChainNode, ChainEdge } from '../types'

function parseEndpoint(s: string): { node: string; socket: string } {
  const str = String(s)
  const dot = str.indexOf('.')
  if (dot === -1) return { node: str.trim(), socket: 'output' }
  return { node: str.slice(0, dot).trim(), socket: str.slice(dot + 1).trim() }
}

export function parseChainContent(raw: string, slug: string): ChainDef {
  const { data } = matter(raw)
  const nodes: ChainNode[] = Array.isArray(data.nodes)
    ? data.nodes.map((n: Record<string, unknown>) => ({
        id: String(n.id),
        kind: n.kind as ChainNode['kind'],
        agent: n.agent as string | undefined,
        file: n.file as string | undefined,
        pos: Array.isArray(n.pos) ? [Number(n.pos[0]), Number(n.pos[1])] as [number, number] : undefined,
        condition: n.condition as string | undefined,
        cases: Array.isArray(n.cases)
          ? (n.cases as Record<string, unknown>[]).map(c => ({ label: String(c.label), condition: String(c.condition) }))
          : undefined,
        default: n.default as string | undefined,
        zone: n.zone as string | undefined,
        state: Array.isArray(n.state) ? (n.state as unknown[]).map(String) : undefined,
        until: n.until as string | undefined,
        maxIterations: typeof n.maxIterations === 'number' ? n.maxIterations : undefined,
      }))
    : []
  const edges: ChainEdge[] = Array.isArray(data.edges)
    ? data.edges.map((e: Record<string, unknown>) => {
        const from = parseEndpoint(e.from as string)
        const to = parseEndpoint(e.to as string)
        return { fromNode: from.node, fromSocket: from.socket, toNode: to.node, toSocket: to.socket }
      })
    : []
  return { slug, name: data.name, description: data.description ?? '', nodes, edges, filePath: '', isFavorite: false }
}

export function parseChain(filePath: string): ChainDef {
  const raw = fs.readFileSync(filePath, 'utf-8')
  const slug = path.basename(filePath, '.md')
  return { ...parseChainContent(raw, slug), filePath }
}

export function loadAllChains(workspacePath: string): ChainDef[] {
  const chainsDir = path.join(workspacePath, 'chains')
  if (!fs.existsSync(chainsDir)) return []
  return fs.readdirSync(chainsDir)
    .filter(f => f.endsWith('.md'))
    .map(f => parseChain(path.join(chainsDir, f)))
}
