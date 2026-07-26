import { ChainDef, ChainNode, AgentDef, AgentOutput } from './types'
import { parseSlots } from './slots'
import { extractSection, extractSections, slugify } from './graph'
import type { SectionWarning } from './sectionWarning'

// Pure — reporting the miss is the caller's job (#37).
export interface SocketRead {
  value: string
  missingSection?: string
}

// Resolves the value carried on a source node's socket.
// seed -> seed prompt; context -> file; gate/branch -> their pass-through output
// (socket ignored); agent/decider -> output (full) or a named section.
export function readSocket(
  src: ChainNode,
  socket: string,
  nodeOutputs: Map<string, AgentOutput>,
  seedPrompt: string,
  readContext: (file: string) => string,
): SocketRead {
  if (src.kind === 'seed') {
    const o = nodeOutputs.get(src.id)
    return { value: o ? o.output : seedPrompt }
  }
  if (src.kind === 'context') return { value: readContext(src.file || '') }
  if (src.kind === 'subchain') {
    const o = nodeOutputs.get(`${src.id}::${slugify(socket)}`)
    return { value: o ? o.output : '' }
  }
  if (src.kind === 'loop-start' || src.kind === 'loop-end') {
    const o = nodeOutputs.get(`${src.id}::${slugify(socket)}`)
    return { value: o ? o.output : '' }
  }
  if (src.kind === 'gate' || src.kind === 'branch') {
    const o = nodeOutputs.get(src.id)
    return { value: o ? o.output : '' }
  }
  const o = nodeOutputs.get(src.id)
  if (!o) return { value: '' }
  if (slugify(socket) === 'output') return { value: o.output }
  const value = extractSection(o.output, socket)
  // An empty value is only a miss when the heading itself is absent — a heading
  // present with an empty body extracts to '' too, and did honour the convention.
  const missing = value === '' && !extractSections(o.output).includes(slugify(socket))
  return missing ? { value, missingSection: socket } : { value }
}

export interface ResolvedPrompt {
  prompt: string
  warnings: SectionWarning[]
}

export function resolveNodePrompt(
  node: ChainNode,
  chain: ChainDef,
  agent: AgentDef,
  nodeOutputs: Map<string, AgentOutput>,
  seedPrompt: string,
  readContext: (file: string) => string,
): ResolvedPrompt {
  let out = agent.systemPrompt
  const warnings: SectionWarning[] = []
  for (const slot of parseSlots(agent.systemPrompt)) {
    const edge = chain.edges.find(e => e.toNode === node.id && e.toSocket === slot)
    let value: string
    if (!edge) {
      value = `[${slot}: not wired]`
    } else {
      const src = chain.nodes.find(n => n.id === edge.fromNode)
      if (!src) {
        value = `[${slot}: source "${edge.fromNode}" missing]`
      } else {
        const read = readSocket(src, edge.fromSocket, nodeOutputs, seedPrompt, readContext)
        value = read.value
        if (read.missingSection) {
          warnings.push({ fromNode: edge.fromNode, section: read.missingSection, toNode: node.id, toSocket: slot })
        }
      }
    }
    const re = new RegExp(`\\{\\s*${slot}\\s*\\}`, 'g')
    out = out.replace(re, value)
  }
  return { prompt: out, warnings }
}
