import { NextRequest } from 'next/server'
import { loadWorkspace } from '@/lib/fs/workspace'
import { continueRun } from '@/lib/continueRun'
import { readForkRequest } from '@/lib/fork'
import { loadRunFor } from '@/lib/loadRun'
import { toResponse } from '@/lib/refusal'

// A new run from this one: rerun from a node, or set revised outputs; either way their
// descendants rerun and the answered holds above them carry over (#103).
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ runId: string }> },
) {
  const { runId } = await params
  const body = await req.json().catch(() => ({}))
  const fork = readForkRequest(body ?? {})
  if ('error' in fork) return toResponse(fork)

  const meta = loadRunFor(runId, { mustNotBeRunning: true })
  if ('error' in meta) return toResponse(meta)
  return continueRun(loadWorkspace(), meta, { fork }, body?.context)
}
