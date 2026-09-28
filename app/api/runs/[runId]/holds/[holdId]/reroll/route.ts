import { NextRequest } from 'next/server'
import { continueRun } from '@/lib/continueRun'
import { requestWorkspace } from '@/lib/requestWorkspace'
import { readRerollRequest } from '@/lib/reroll'
import { toResponse } from '@/lib/refusal'

// Fresh candidates at a hold: only its producer reruns, in place (#134) or in a fork (#147).
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ runId: string; holdId: string }> },
) {
  const { runId, holdId } = await params
  const body = await req.json().catch(() => ({}))
  const reroll = readRerollRequest(holdId, body ?? {})
  if ('error' in reroll) return toResponse(reroll)
  return continueRun(requestWorkspace(), runId, { reroll })
}
