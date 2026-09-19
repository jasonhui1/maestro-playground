import { NextRequest, NextResponse } from 'next/server'
import { readRunMeta } from '@/lib/logger'
import { loadWorkspace } from '@/lib/fs/workspace'
import { continueRun } from '@/lib/continueRun'
import type { RunMeta } from '@/lib/types'

// Use this: in place on a waiting run, rerunning to the hold (#98);
// a finished run, or one past an answered hold, forks instead (#99).
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ runId: string; nodeId: string }> },
) {
  const { runId, nodeId } = await params
  const body = await req.json().catch(() => ({}))
  const { turn, context } = body ?? {}
  if (turn != null && !Number.isInteger(turn)) {
    return NextResponse.json({ error: 'turn must be a whole number' }, { status: 400 })
  }

  let meta: RunMeta
  try {
    meta = readRunMeta(runId)
  } catch {
    return NextResponse.json({ error: 'Run not found' }, { status: 404 })
  }
  return continueRun(loadWorkspace(), meta, { promote: { nodeId, turn: turn ?? undefined } }, context)
}
