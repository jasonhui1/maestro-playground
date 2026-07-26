// Pure, client-safe grouping of a tool transcript. No `fs`/`path` imports here —
// lib/logger.ts (fs-touching) uses this to render the log; slice 2's trace UI
// can import it directly too, without dragging a Node-only module into the
// browser bundle (see lib/tools/spec.ts for the same split).
import { ToolCallRecord } from '../types'

// Generic so the live reducer's in-flight calls, which carry an extra status,
// group through this function rather than a second implementation (#35).
export interface ToolTurnGroup<T extends ToolCallRecord = ToolCallRecord> {
  turn: number
  calls: T[]
  latencyMs: number      // summed across the group's calls
  turnText?: string      // read from the group's first record only
}

// A turn is not a call: one assistant message can carry several tool_calls
// (parallel fan-out), all sharing `ToolCallRecord.turn`. Assumes same-turn
// records are contiguous in `toolCalls` — true today because the tool loop
// appends records in execution order; a caller feeding reordered records
// would split one turn into two groups.
export function groupToolCallsByTurn<T extends ToolCallRecord>(toolCalls: T[]): ToolTurnGroup<T>[] {
  const groups: ToolTurnGroup<T>[] = []

  for (const call of toolCalls) {
    const last = groups[groups.length - 1]
    if (last && last.turn === call.turn) {
      last.calls.push(call)
      last.latencyMs += call.latencyMs
    } else {
      groups.push({ turn: call.turn, calls: [call], latencyMs: call.latencyMs, turnText: call.turnText })
    }
  }

  return groups
}
