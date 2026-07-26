// What the tool loop narrates while it runs. Pure types, so the browser reducer
// and the Node-side loop share one vocabulary (#35).

export type ToolLoopEvent =
  // Turn-level, not call-level: parallel calls announce once, and no args ride along.
  | { type: 'tool_pending'; turn: number }
  | { type: 'tool_call'; turn: number; name: string; args: unknown; activity?: string }
  // `result` rides along in full so a chip can expand mid-run (#36).
  | { type: 'tool_result'; turn: number; name: string; result: string; latencyMs: number; isError: boolean }

export type ToolEventSink = (event: ToolLoopEvent) => void

// The loop is the only thing that stamps `turn` — a second notion of what
// belongs to a turn is the bug #26 fixed in the log.
export interface ToolNarration {
  onEvent?: ToolEventSink
  onToken?: (token: string, type: 'thought' | 'output', turn: number) => void
}
