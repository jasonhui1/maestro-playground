import { NextRequest } from 'next/server'
import { loadWorkspace } from '@/lib/fs/workspace'
import { continueRun } from '@/lib/continueRun'
import { diskWorkspace } from '@/lib/runFolders'
import { readPromoteRequest } from '@/lib/promote'
import { toResponse } from '@/lib/refusal'

// Use this: in place on a waiting run, rerunning to the hold (#98);
// a finished run, or one past an answered hold, forks instead (#99).
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ runId: string; nodeId: string }> },
) {
  const { runId, nodeId } = await params
  const body = await req.json().catch(() => ({}))
  const promote = readPromoteRequest(nodeId, body ?? {})
  if ('error' in promote) return toResponse(promote)
  return continueRun(diskWorkspace(), loadWorkspace(), runId, { promote }, body?.context)
}
