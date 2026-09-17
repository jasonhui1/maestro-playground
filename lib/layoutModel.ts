import { ChainDef, ChainPort, AgentOutput } from './types'
import { extractSection } from './graph'
import { latestOutputsByNode } from './runHistoryState'

/** A layout a chain file may name in `view:`. Adding one is a branch here (ADR-0015). */
export type DeclaredView = 'timeline' | 'columns' | 'sidebar'

/** What the result view renders: a declared layout, or the run-trace fallback. */
export type LayoutKind = DeclaredView | 'undeclared'

/**
 * `pending` — the run has not reached this node yet.
 * `empty`   — it ran, and this socket resolved to nothing (ADR-0015).
 * `errored` — nothing reached this socket because nothing was produced: the node
 *              failed, or the run died before reaching it (#77).
 * `skipped` — control flow went the other way and the node never ran.
 * `filled`  — there is content.
 */
export type PanelState = 'pending' | 'empty' | 'errored' | 'skipped' | 'filled'

export interface LayoutPanel {
  /** The chain's public name for this output, shown as the panel's label. */
  name: string
  /** The inner node this panel's port binds to — what a live token event is keyed by,
   *  so a streaming view can overlay tokens without matching on the display name (#76). */
  node: string
  /** What travelled on this socket — the same text the engine handed downstream. */
  text: string
  /** Content volume the view scales the panel by; 0 unless `filled`. */
  lines: number
  state: PanelState
  /** `'last'` — a timeline's surviving skeleton. `'join'` — a columns chain's
   *  converging panel, declared by the port rather than inferred from position (ADR-0016). */
  emphasis?: 'last' | 'join'
  /** Why the node failed, when `state` is `errored` — the engine's own message. */
  error?: string
  /** Set under `view: sidebar` only — the loop round this panel is (ADR-0016 rule 4). */
  round?: number
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

/**
 * What a panel has to say about its node, read from the node's own outcome before its
 * text. A hop that crashed and a hop that dropped the section its edge asked for are
 * different events, and only the second one is `empty` (ADR-0015).
 */
function stateOf(output: AgentOutput | undefined, text: string): PanelState {
  if (!output) return 'pending'
  if (output.status === 'error') return 'errored'
  if (output.status === 'skipped') return 'skipped'
  return text.trim() === '' ? 'empty' : 'filled'
}

function panelFor(port: ChainPort, output: AgentOutput | undefined, name = port.name): LayoutPanel {
  const text = contentOf(output, port.socket)
  const state = stateOf(output, text)
  const panel: LayoutPanel = { name, node: port.node, text, lines: lineCount(text), state }
  if (state === 'errored' && output?.error) panel.error = output.error
  if (port.role === 'join') panel.emphasis = 'join'
  return panel
}

function panelsFor(ports: ChainPort[], outputs: AgentOutput[]): LayoutPanel[] {
  // Last write wins: a loop-body node reports once per round, and the panel shows
  // where the node ended up rather than where it started.
  const byNode = new Map<string, AgentOutput>()
  for (const o of latestOutputsByNode(outputs)) if (o.nodeId) byNode.set(o.nodeId, o)

  return ports.map(port => panelFor(port, byNode.get(port.node)))
}

// A loop-body node reports once per round; under `view: sidebar` each round is its
// own panel rather than collapsing to the last write (ADR-0016 rule 4). A round
// reported more than once (a retry) still collapses to its last write.
function panelsForSidebar(ports: ChainPort[], outputs: AgentOutput[]): LayoutPanel[] {
  return ports.flatMap(port => {
    const byRound = new Map<number, AgentOutput>()
    for (const o of outputs) {
      if (o.nodeId !== port.node) continue
      byRound.set(o.round ?? 0, o)
    }
    return [...byRound.keys()].sort((a, b) => a - b).map((round): LayoutPanel => ({
      ...panelFor(port, byRound.get(round), `${port.name} · round ${round + 1}`),
      round,
    }))
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

  if (chain.view === 'sidebar') return { kind: 'sidebar', panels: panelsForSidebar(ports, outputs) }

  return UNDECLARED
}

/**
 * The same panels, as a failed run leaves them: everything still `pending` moves to
 * `errored` carrying the run's message.
 *
 * A run that dies before a hop produces no output to derive a panel state from, so
 * without this the last frame a client holds says `pending` forever and it has to read
 * the run-level error to know better — which is the client inferring panel meaning, the
 * thing the projection exists to prevent (#77). The distinction between "this node
 * failed" and "the run never got there" stays legible in the message rather than in a
 * separate state, because a new `PanelState` is silent on arrival to an older client.
 */
export function failLayoutModel(model: LayoutModel, error: string): LayoutModel {
  return {
    kind: model.kind,
    panels: model.panels.map(p =>
      p.state === 'pending' ? { ...p, state: 'errored' as const, error } : p
    ),
  }
}

/**
 * True once the run's own outputs actually landed in a declared panel.
 *
 * A chain edited since a run happened (a port's `node` renamed, say) still declares a
 * `view` and still builds a model, but every panel reads `pending` against outputs that
 * exist — that's not a live run still in flight, it's a stale mapping. A caller
 * reopening a past run treats that the same as `undeclared`, rather than showing a
 * "complete" run stuck in a shape that never filled in (#72).
 */
export function isRenderableLayout(model: LayoutModel): boolean {
  return model.kind !== 'undeclared' && model.panels.some(p => p.state !== 'pending')
}
