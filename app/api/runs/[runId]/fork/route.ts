import { NextRequest, NextResponse } from 'next/server'
import { readRunMeta } from '@/lib/logger'
import { loadWorkspace } from '@/lib/fs/workspace'
import { continueRun } from '@/lib/continueRun'
import type { RunMeta } from '@/lib/types'

// A new run from this one: rerun from a node, or set revised outputs; either way their
// descendants rerun and the answered holds above them carry over (#103).
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ runId: string }> },
) {
  const { runId } = await params
  const body = await req.json().catch(() => ({}))
  const { from, revisions, versions, context } = body ?? {}

  let meta: RunMeta
  try {
    meta = readRunMeta(runId)
  } catch {
    return NextResponse.json({ error: 'Run not found' }, { status: 404 })
  }
  return continueRun(loadWorkspace(), meta, { fork: { from, revisions, versions } }, context)
}
