import { NextRequest } from 'next/server'
import { continueRun } from '@/lib/continueRun'
import { requestWorkspace } from '@/lib/requestWorkspace'
import { readAnswerRequest } from '@/lib/hold'
import { toResponse } from '@/lib/refusal'

// Resume is replay, in the same run folder, of every output plus the hold's answer (#94);
// re-answering an answered hold forks instead (#99).
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
