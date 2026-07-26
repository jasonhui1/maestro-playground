import { AgentOutput, ChainNode } from './types'

// Optional: a replayed branch output can carry a synthetic nodeId absent from
// the graph, so its kind is unknowable (#35).
type NodeKind = ChainNode['kind']

export type RunEvent =
  | { type: 'agent_start'; nodeId: string; agentName: string; step: number; kind?: NodeKind }
  | { type: 'token'; nodeId: string; agentName?: string; token: string; tokenType?: string; step?: number; kind?: NodeKind; turn?: number }
  | { type: 'agent_done'; nodeId: string; agentName: string; step: number; output: AgentOutput; kind?: NodeKind }
  | { type: 'tool_pending'; nodeId: string; step?: number; kind?: NodeKind; turn: number }
  | { type: 'tool_call'; nodeId: string; step?: number; kind?: NodeKind; turn: number; name: string; args: unknown; activity?: string }
  | { type: 'tool_result'; nodeId: string; step?: number; kind?: NodeKind; turn: number; name: string; latencyMs: number; isError: boolean }
  | { type: 'run_complete'; runId: string }
  | { type: 'error'; error: string }

export async function streamRun(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  onEvent: (e: RunEvent) => void,
): Promise<void> {
  const decoder = new TextDecoder()
  let buffer = ''
  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })
    const frames = buffer.split('\n\n')
    buffer = frames.pop() ?? ''
    for (const frame of frames) {
      const line = frame.split('\n').find(l => l.startsWith('data: '))
      if (!line) continue
      try {
        onEvent(JSON.parse(line.slice(6)) as RunEvent)
      } catch {
        // ignore malformed frame
      }
    }
  }
}
