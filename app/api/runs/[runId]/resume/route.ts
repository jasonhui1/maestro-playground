import { NextRequest, NextResponse } from 'next/server'
import { readRunMeta } from '@/lib/logger'
import { loadWorkspace } from '@/lib/fs/workspace'
import { continueRun } from '@/lib/continueRun'
import { readAnswerRequest } from '@/lib/hold'
import type { RunMeta } from '@/lib/types'

// Resume is replay, in the same run folder, of every output plus the hold's answer (#94);
// re-answering an answered hold forks instead (#99).
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ runId: string }> },
) {
  const { runId } = await params
  const body = await req.json().catch(() => ({}))
  const answer = readAnswerRequest(body ?? {})
  if ('error' in answer) return NextResponse.json(answer, { status: 400 })

  let meta: RunMeta
  try {
    meta = readRunMeta(runId)
  } catch {
    return NextResponse.json({ error: 'Run not found' }, { status: 404 })
  }
  return continueRun(loadWorkspace(), meta, { answer }, body?.context)
}
