import { NextRequest } from 'next/server'
import { requestWorkspace } from '@/lib/requestWorkspace'
import { saveFeedback } from '@/lib/reroll'

// Saves an open hold's reroll feedback without generating (#134).
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ runId: string; holdId: string }> },
) {
  const { runId, holdId } = await params
  const body = await req.json().catch(() => ({}))
  return saveFeedback(requestWorkspace(), runId, holdId, body ?? {})
}
