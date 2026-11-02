import { ChainDef, ChainPort, AgentOutput, DiceRoll, RunDice } from './types'
import { latestOutputsByNode } from './runHistoryState'
import { readSocket, type SocketEnv } from './resolveNode'
import { outputKey, runStateKey } from './tokens'

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
  /** The port's socket, `output` for the whole text — with `node`, the address a fork's
   *  `revisions` names to edit this panel alone (#160). */
  socket: string
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
  /** What the panel's node rolled, by axis; absent on a node that rolls no dice (#153). */
  dice?: DiceRoll
}

export interface LayoutModel {
  kind: LayoutKind
  panels: LayoutPanel[]
}

const UNDECLARED: LayoutModel = { kind: 'undeclared', panels: [] }

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

type Records = SocketEnv['outputs']

function recordsOf(outputs: AgentOutput[]): Map<string, AgentOutput> {
  const records = new Map<string, AgentOutput>()
  for (const o of outputs) if (o.nodeId) records.set(runStateKey(o.nodeId), o)
  return records
}

// The text reads through the edge's reader, so a panel holds what the next hop received
// (ADR-0015); a node with no record of its own (a loop-start) answers by its socket's record.
function panelFor(chain: ChainDef, port: ChainPort, records: Records, dice: RunDice, name = port.name): LayoutPanel {
  const socket = port.socket || 'output'
  const output = records.get(port.node) ?? records.get(outputKey(port.node, socket))
  const node = chain.nodes.find(n => n.id === port.node)
  const text = output && node ? readSocket(node, socket, { outputs: records, dice }).value : ''
  const state = stateOf(output, text)
  const panel: LayoutPanel = { name, node: port.node, socket, text, lines: lineCount(text), state }
  if (state === 'errored' && output?.error) panel.error = output.error
  if (port.role === 'join') panel.emphasis = 'join'
  if (dice[port.node]) panel.dice = dice[port.node]
  return panel
}

function panelsFor(chain: ChainDef, ports: ChainPort[], outputs: AgentOutput[], dice: RunDice): LayoutPanel[] {
  // Last write wins: a loop-body node reports once per round, and the panel shows
  // where the node ended up rather than where it started.
  const records = recordsOf(latestOutputsByNode(outputs))
  return ports.map(port => panelFor(chain, port, records, dice))
}

// A loop-body node reports once per round; under `view: sidebar` each round is its
// own panel rather than collapsing to the last write (ADR-0016 rule 4). A round
// reported more than once (a retry) still collapses to its last write.
function panelsForSidebar(chain: ChainDef, ports: ChainPort[], outputs: AgentOutput[], dice: RunDice): LayoutPanel[] {
  const latest = recordsOf(latestOutputsByNode(outputs))
  return ports.flatMap(port => {
    const byRound = new Map<number, AgentOutput>()
    for (const o of outputs) {
      if (o.nodeId !== port.node) continue
      byRound.set(o.round ?? 0, o)
    }
    return [...byRound].sort(([a], [b]) => a - b).map(([round, record]): LayoutPanel => {
      const records: Records = { get: key => key === port.node ? record : latest.get(key) }
      return { ...panelFor(chain, port, records, dice, `${port.name} · round ${round + 1}`), round }
    })
  })
}

/**
 * Project a run's outputs onto the panels its chain declares (ADR-0015).
 *
 * Reads `view` and `outputs`, never an edge; a node's kind only decides how its socket
 * reads. A chain that declares no layout is not opted in, and the caller renders it as
 * the run trace.
 */
export function buildLayoutModel(chain: ChainDef, outputs: AgentOutput[], dice: RunDice = {}): LayoutModel {
  const ports = chain.outputs ?? []
  if (ports.length === 0) return UNDECLARED

  if (chain.view === 'timeline') {
    const panels = panelsFor(chain, ports, outputs, dice)
    panels[panels.length - 1].emphasis = 'last'
    return { kind: 'timeline', panels }
  }

  // A columns chain with no `role: join` port renders its columns and nothing
  // beneath them (ADR-0016) — there is no "last panel" fallback here.
  if (chain.view === 'columns') return { kind: 'columns', panels: panelsFor(chain, ports, outputs, dice) }

  if (chain.view === 'sidebar') return { kind: 'sidebar', panels: panelsForSidebar(chain, ports, outputs, dice) }

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
