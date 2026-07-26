// The run panel's view of a tool loop (#36).
import { NodeRunState, toolTurnsOf } from './runState'

export interface NarratedCall {
  label: string        // the tool's activity line, or its name when it declares none
  name: string
  args: unknown
  result: string
  latencyMs: number
  isError: boolean
  status: 'running' | 'done'
}

export interface NarratedTurn {
  turn: number
  calls: NarratedCall[]
  turnText?: string
  latencyMs: number
  pending: boolean     // arguments still composing, so no call is executable yet
}

export interface Narration {
  turns: NarratedTurn[]
  answer: string
  isNarrating: boolean
}

export function narrationOf(state: NodeRunState): Narration {
  const groups = toolTurnsOf(state)

  const turns: NarratedTurn[] = groups.map(g => {
    // Live, a turn's text arrives as tokens; replayed, it rides on the turn's
    // first record.
    const turnText = g.turnText ?? state.turnText[g.turn]
    return {
      turn: g.turn,
      latencyMs: g.latencyMs,
      pending: false,
      ...(turnText ? { turnText } : {}),
      calls: g.calls.map(c => ({
        label: c.activity ?? c.name,
        name: c.name,
        args: c.args,
        result: c.result,
        latencyMs: c.latencyMs,
        isError: c.isError,
        status: c.status,
      })),
    }
  })

  if (state.pendingTurn !== undefined && !groups.some(g => g.turn === state.pendingTurn)) {
    turns.push({ turn: state.pendingTurn, calls: [], latencyMs: 0, pending: true })
  }

  return { turns, answer: answerOf(state, turns), isNarrating: turns.length > 0 }
}

// Every turn's tokens carry a turn number, the answering turn's included — so the
// answer is the text of the newest turn that executed no call. Announcing calls is
// not enough: a forced final turn can emit tool-call deltas and still answer.
function answerOf(state: NodeRunState, turns: NarratedTurn[]): string {
  if (state.output !== '') return state.output

  const executed = turns.filter(t => t.calls.length > 0)
  const orphan = Object.keys(state.turnText)
    .map(Number)
    .filter(t => !executed.some(row => row.turn === t))
    .sort((a, b) => b - a)[0]

  return orphan === undefined ? '' : state.turnText[orphan]
}
