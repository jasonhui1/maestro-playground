import { ChainDef, ChainPort, AgentOutput } from './types'
import { extractSection } from './graph'

/** A layout a chain file may name in `view:`. Adding one is a branch here (ADR-0015). */
export type DeclaredView = 'timeline' | 'columns'

/** What the result view renders: a declared layout, or the run-trace fallback. */
export type LayoutKind = DeclaredView | 'undeclared'

/**
 * `pending` — the run has not reached this node yet.
 * `empty`   — it ran, and this socket resolved to nothing (ADR-0015).
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
  /** `'last'` — a timeline's surviving skeleton. `'join'` — a columns chain's
   *  converging panel, declared by the port rather than inferred from position (ADR-0016). */
  emphasis?: 'last' | 'join'
}

export interface LayoutModel {
  kind: LayoutKind
  panels: LayoutPanel[]
}

const UNDECLARED: LayoutModel = { kind: 'undeclared', panels: [] }

// `output` is the whole text; any other socket names a section of it, resolved the way
// an edge resolves — so a panel holds what the next hop received (ADR-0015).
function contentOf(output: AgentOutput | undefined, socket: string | undefined): string {
  if (!output) return ''
  if (!socket || socket === 'output') return output.output
  return extractSection(output.output, socket)
}

function lineCount(text: string): number {
  const trimmed = text.trim()
  return trimmed === '' ? 0 : trimmed.split('\n').length
}

function panelsFor(ports: ChainPort[], outputs: AgentOutput[]): LayoutPanel[] {
  // Last write wins: a loop-body node reports once per round, and the panel shows
  // where the node ended up rather than where it started.
  const byNode = new Map<string, AgentOutput>()
  for (const o of outputs) if (o.nodeId) byNode.set(o.nodeId, o)

  return ports.map((port): LayoutPanel => {
    const output = byNode.get(port.node)
    const text = contentOf(output, port.socket)
    const state: PanelState = !output ? 'pending' : text.trim() === '' ? 'empty' : 'filled'
    const panel: LayoutPanel = { name: port.name, text, lines: lineCount(text), state }
    if (port.role === 'join') panel.emphasis = 'join'
    return panel
  })
}

/**
 * Project a run's outputs onto the panels its chain declares (ADR-0015).
 *
 * Reads `view` and `outputs` only — never an edge or a node kind. A chain that
 * declares no layout is not opted in, and the caller renders it as the run trace.
 */
export function buildLayoutModel(chain: ChainDef, outputs: AgentOutput[]): LayoutModel {
  const ports = chain.outputs ?? []
  if (ports.length === 0) return UNDECLARED

  if (chain.view === 'timeline') {
    const panels = panelsFor(ports, outputs)
    panels[panels.length - 1].emphasis = 'last'
    return { kind: 'timeline', panels }
  }

  // A columns chain with no `role: join` port renders its columns and nothing
  // beneath them (ADR-0016) — there is no "last panel" fallback here.
  if (chain.view === 'columns') return { kind: 'columns', panels: panelsFor(ports, outputs) }

  return UNDECLARED
}
