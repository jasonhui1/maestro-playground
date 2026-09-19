import { streamRun, endedRunId } from './runStream'

// Reruns a run from one node on the engine's fork path (#103). Drives the SSE stream to
// completion and returns the new run's id (null if it ended without a run_complete or run_waiting).
export async function forkFromNode(runId: string, nodeId: string): Promise<string | null> {
  const res = await fetch(`/api/runs/${encodeURIComponent(runId)}/fork`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ from: nodeId }),
  })
  if (!res.ok || !res.body) throw new Error(`Fork failed (${res.status})`)

  let newRunId: string | null = null
  await streamRun(res.body.getReader(), event => {
    newRunId = endedRunId(event) ?? newRunId
  })
  return newRunId
}
