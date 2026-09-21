import { ChainDef, ChainNode, AgentDef, AgentOutput } from './types'
import { extractSection, extractSections } from './graph'
import { promptSlots, fillSlot, socketKey, outputKey, isWholeOutput } from './tokens'
import type { SectionWarning } from './sectionWarning'
import { hasLiteralInput } from './chainGraph'

// Pure — reporting the miss is the caller's job (#37).
export interface SocketRead {
  value: string
  missingSection?: string  // heading absent: a convention violation, warned on
  emptySection?: string    // heading present, body blank: honoured the convention, not warned on
}

// Resolves the value carried on a source node's socket.
// seed -> seed prompt; context -> file; param -> the run's dropdown pick;
// gate/branch -> their pass-through output (socket ignored); agent/decider ->
// output (full) or a named section.
export function readSocket(
  src: ChainNode,
  socket: string,
  nodeOutputs: Map<string, AgentOutput>,
  seedPrompt: string,
  readContext: (file: string) => string,
  paramValue: string = '',
): SocketRead {
  if (src.kind === 'seed') {
    const o = nodeOutputs.get(src.id)
    return { value: o ? o.output : seedPrompt }
  }
  if (src.kind === 'context') return { value: readContext(src.file || '') }
  if (src.kind === 'param') return { value: paramValue }
  if (src.kind === 'subchain') {
    const o = nodeOutputs.get(outputKey(src.id, socket))
    return { value: o ? o.output : '' }
  }
  if (src.kind === 'loop-start' || src.kind === 'loop-end') {
    const o = nodeOutputs.get(outputKey(src.id, socket))
    return { value: o ? o.output : '' }
  }
  if (src.kind === 'gate' || src.kind === 'branch') {
    const o = nodeOutputs.get(src.id)
    return { value: o ? o.output : '' }
  }
  const o = nodeOutputs.get(src.id)
  if (!o) return { value: '' }
  if (isWholeOutput(socket)) return { value: o.output }
  const value = extractSection(o.output, socket)
  if (value !== '') return { value }
  return extractSections(o.output).includes(socketKey(socket))
    ? { value, emptySection: socket }
    : { value, missingSection: socket }
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
  paramValue: string = '',
): ResolvedPrompt {
  let out = agent.systemPrompt
  const warnings: SectionWarning[] = []
  for (const slot of promptSlots(agent.systemPrompt)) {
    const edge = chain.edges.find(e => e.toNode === node.id && e.toSocket === slot)
    let value: string
    if (edge) {
      const src = chain.nodes.find(n => n.id === edge.fromNode)
      if (!src) {
        value = `[${slot}: source "${edge.fromNode}" missing]`
      } else {
        const read = readSocket(src, edge.fromSocket, nodeOutputs, seedPrompt, readContext, paramValue)
        value = read.value
        if (read.missingSection) {
          warnings.push({ fromNode: edge.fromNode, section: read.missingSection, toNode: node.id, toSocket: slot })
        } else if (read.emptySection) {
          value = `[${slot}: "${read.emptySection}" section empty]`
        }
      }
    } else if (hasLiteralInput(node, slot)) {
      value = node.inputs![slot]
    } else {
      value = `[${slot}: not wired]`
    }
    out = fillSlot(out, slot, value).text
  }
  return { prompt: out, warnings }
}
