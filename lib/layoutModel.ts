import { ChainDef, AgentOutput } from './types'
import { extractSection } from './graph'

// A chain says which of its outputs are worth looking at and how they sit together;
// nothing here reads the node graph. Inferring panels from graph shape discards outputs
// only the author knows are interesting — a report tapped off a hop is a panel or is
// noise, and no rule about node kinds can tell which (#66).
export type LayoutKind = 'timeline' | 'undeclared'

/**
 * `pending` — the run has not reached this node yet.
 * `empty`   — it ran, and this socket resolved to nothing. A hop that dropped the
 *             section its edge asked for reads as a failure, not as still-loading;
 *             the executor raises the matching warning (#37).
 * `filled`  — there is content.
 */
export type PanelState = 'pending' | 'empty' | 'filled'

export interface LayoutPanel {
  /** The chain's public name for this output, shown as the panel's label. */
  name: string
  /** What travelled on this socket — the same text the engine handed downstream. */
  text: string
  /** Content volume the view scales the panel by; 0 unless `filled`. */
  lines: number
  state: PanelState
  /** Set on the panel the reader should land on: a timeline's surviving skeleton. */
  emphasis?: 'last'
}

export interface LayoutModel {
  kind: LayoutKind
  panels: LayoutPanel[]
}

const UNDECLARED: LayoutModel = { kind: 'undeclared', panels: [] }

// `output` is the whole text; any other socket names a markdown section of it, which is
// what the executor's edges resolve too — so a panel shows what the next hop received,
// not what the node wrote around it.
function contentOf(output: AgentOutput | undefined, socket: string | undefined): string {
  if (!output) return ''
  if (!socket || socket === 'output') return output.output
  return extractSection(output.output, socket)
}

function lineCount(text: string): number {
  const trimmed = text.trim()
  return trimmed === '' ? 0 : trimmed.split('\n').length
}

/**
 * Project a run's outputs onto the panels its chain declares.
 *
 * A chain with no `view` is not opted in, and gets an empty `undeclared` model the
 * caller renders as the ordinary run trace.
 */
export function buildLayoutModel(chain: ChainDef, outputs: AgentOutput[]): LayoutModel {
  if (chain.view !== 'timeline') return UNDECLARED
  const ports = chain.outputs ?? []
  if (ports.length === 0) return UNDECLARED

  // Last write wins: a loop-body node reports once per round, and the panel shows
  // where the node ended up rather than where it started.
  const byNode = new Map<string, AgentOutput>()
  for (const o of outputs) if (o.nodeId) byNode.set(o.nodeId, o)

  const panels = ports.map((port): LayoutPanel => {
    const output = byNode.get(port.node)
    const text = contentOf(output, port.socket)
    const state: PanelState = !output ? 'pending' : text.trim() === '' ? 'empty' : 'filled'
    return { name: port.name, text, lines: lineCount(text), state }
  })
  panels[panels.length - 1].emphasis = 'last'
  return { kind: 'timeline', panels }
}
