import { streamRun } from './runStream'
import type { RunMeta } from './types'

// Re-run a chain from an earlier step, replaying the original run's outputs up to
// that point. Drives the SSE stream to completion and returns the new run's id
// (null if the stream ended without a run_complete).
export async function branchRun(run: RunMeta, fromStep: number): Promise<string | null> {
  const res = await fetch('/api/run', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      chainName: run.chainName,
      seedPrompt: run.seedPrompt,
      branchedFromRunId: run.runId,
      branchedFromStep: fromStep,
      branchOutputs: run.agentOutputs.slice(0, fromStep),
    }),
  })
  if (!res.ok || !res.body) throw new Error(`Branch failed (${res.status})`)

  let newRunId: string | null = null
  await streamRun(res.body.getReader(), event => {
    if (event.type === 'run_complete') newRunId = event.runId
  })
  return newRunId
}
