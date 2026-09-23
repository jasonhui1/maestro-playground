import { streamRun, endedRunId } from './runStream'

export interface ForkFromNodeOptions {
  modelOverride?: string | null
  promptOverride?: string
  revisions?: Record<string, string>
}

// Reruns a run from one node on the engine's fork path (#103, #128, #143).
export async function forkFromNode(
  runId: string,
  nodeId: string,
  opts?: ForkFromNodeOptions
): Promise<string | null> {
  const body: Record<string, unknown> = {}
  if (opts?.revisions) {
    body.revisions = opts.revisions
  } else if (opts?.promptOverride) {
    body.revisions = { [nodeId]: opts.promptOverride }
  } else {
    body.from = nodeId
  }
  if (opts && 'modelOverride' in opts && opts.modelOverride !== undefined) {
    body.modelOverride = opts.modelOverride
  }
  const res = await fetch(`/api/runs/${encodeURIComponent(runId)}/fork`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  if (!res.ok || !res.body) throw new Error(`Fork failed (${res.status})`)

  let newRunId: string | null = null
  await streamRun(res.body.getReader(), event => {
    newRunId = endedRunId(event) ?? newRunId
  })
  return newRunId
}
