import { NextRequest } from 'next/server'
import { continueRun } from '@/lib/continueRun'
import { requestWorkspace } from '@/lib/requestWorkspace'
import { readAnswerRequest } from '@/lib/hold'
import { toResponse } from '@/lib/refusal'

// Resume replays the hold answer in place (#94), or forks for an answered hold (#99)
// or an independent pick (#76).
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ runId: string }> },
) {
  const { runId } = await params
  const body = await req.json().catch(() => ({}))
  const answer = readAnswerRequest(body ?? {})
  if ('error' in answer) return toResponse(answer)
  return continueRun(requestWorkspace(), runId, { answer }, body?.context)
}
