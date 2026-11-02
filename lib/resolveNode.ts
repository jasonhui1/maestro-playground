import { ChainDef, ChainNode, AgentDef, AgentOutput, DiceRoll, RunDice } from './types'
import { extractSectionPath } from './graph'
import { agentSlots, fillSlot, outputKey, type Endpoint } from './tokens'
import { emitSectionWarnings, type SectionWarning } from './sectionWarning'
import { hasLiteralInput } from './chainGraph'
import { kindOf } from './nodeKinds'
import { sectionedReading } from './nodeSockets'
import { unreachable } from './unreachable'
import { diceLines, fillDice } from './dice'

// Pure — reporting the miss is the caller's job (#37).
export interface SocketRead {
  value: string
  missingSection?: string    // heading absent: a convention violation, warned on
  emptySection?: string      // heading present, body blank: honoured the convention, not warned on
  ambiguousSection?: string  // duplicate headings: warned on, first match used (#129)
}

/** What a socket reads besides its node: the run's records and supplied values (#166). */
export interface SocketEnv {
  /** Records by node id, or by `outputKey` for a keyed socket. */
  outputs: Pick<Map<string, AgentOutput>, 'get'>
  seedPrompt?: string
  readContext?: (file: string) => string
  paramValue?: string
  dice?: RunDice
}

// What an edge from `src.socket` delivers; conditions and panels read through it too (#166).
export function readSocket(src: ChainNode, socket: string, env: SocketEnv): SocketRead {
  const { outputs, seedPrompt = '', readContext = () => '', paramValue = '', dice = {} } = env
  const read = kindOf(src.kind).read
  switch (read) {
    case 'seed': return { value: outputs.get(src.id)?.output ?? seedPrompt }
    case 'context': return { value: readContext(src.kind === 'context' ? src.file || '' : '') }
    case 'param': return { value: paramValue }
    case 'pass-through': return { value: outputs.get(src.id)?.output ?? '' }
    case 'keyed': return { value: outputs.get(outputKey(src.id, socket))?.output ?? '' }
    case 'sectioned': return readSectioned(outputs.get(src.id), socket, dice[src.id])
    default: return unreachable(read)
  }
}

/** Reads a condition's `{node.socket}` refs the way their edges would (#166). */
export function refReader(nodes: Map<string, ChainNode>, env: SocketEnv): (ref: Endpoint) => string {
  return ({ node, socket }) => {
    const src = nodes.get(node)
    return src ? readSocket(src, socket, env).value : ''
  }
}

function readSectioned(o: AgentOutput | undefined, socket: string, roll: DiceRoll | undefined): SocketRead {
  if (!o) return { value: '' }
  const reading = sectionedReading(socket, roll !== undefined)
  if (reading === 'whole') return { value: o.output }
  if (reading === 'roll' && roll) return { value: diceLines(roll) }
  const res = extractSectionPath(o.output, socket)
  if (res.status === 'missing') {
    return {
      value: '',
      missingSection: socket,
      ...(res.ambiguousSegment ? { ambiguousSection: socket } : {}),
    }
  }
  if (res.status === 'ambiguous') {
    return {
      value: res.text,
      ambiguousSection: socket,
      ...(res.empty ? { emptySection: socket } : {}),
    }
  }
  if (res.status === 'empty') {
    return { value: '', emptySection: socket }
  }
  return { value: res.text }
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
  dice: RunDice = {},
): ResolvedPrompt {
  // Before the slots, so a `{dice}` in text arriving on an edge stays text.
  let out = fillDice(agent.systemPrompt, agent.dice ? dice[node.id] : undefined)
  const warnings: SectionWarning[] = []
  for (const slot of agentSlots(agent)) {
    const edge = chain.edges.find(e => e.toNode === node.id && e.toSocket === slot)
    let value: string
    if (edge) {
      const src = chain.nodes.find(n => n.id === edge.fromNode)
      if (!src) {
        value = `[${slot}: source "${edge.fromNode}" missing]`
      } else {
        const read = readSocket(src, edge.fromSocket, { outputs: nodeOutputs, seedPrompt, readContext, paramValue, dice })
        value = read.value
        emitSectionWarnings(read, edge.fromNode, node.id, slot, w => warnings.push(w))
        if (read.emptySection) {
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
