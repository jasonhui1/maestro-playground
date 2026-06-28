import { AgentOutput } from './types'

export type RunEvent =
  | { type: 'agent_start'; nodeId: string; agentName: string; step: number }
  | { type: 'token'; nodeId: string; agentName?: string; token: string; tokenType?: string; step?: number }
  | { type: 'agent_done'; nodeId: string; agentName: string; step: number; output: AgentOutput }
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
