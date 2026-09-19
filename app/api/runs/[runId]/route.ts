import { NextRequest, NextResponse } from 'next/server'
import { loadRunFor } from '@/lib/loadRun'
import { requestWorkspace } from '@/lib/requestWorkspace'
import { toResponse } from '@/lib/refusal'

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ runId: string }> }
) {
  const { runId } = await params
  const meta = loadRunFor(requestWorkspace().runs, runId)
  return 'error' in meta ? toResponse(meta) : NextResponse.json(meta)
}
