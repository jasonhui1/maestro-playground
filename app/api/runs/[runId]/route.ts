import { NextRequest, NextResponse } from 'next/server'
import { loadRunFor } from '@/lib/loadRun'
import { toResponse } from '@/lib/refusal'

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ runId: string }> }
) {
  const { runId } = await params
  const meta = loadRunFor(runId)
  return 'error' in meta ? toResponse(meta) : NextResponse.json(meta)
}
