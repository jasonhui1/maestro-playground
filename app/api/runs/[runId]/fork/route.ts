import { NextRequest, NextResponse } from 'next/server'
import { readRunMeta } from '@/lib/logger'
import { forkRun, planFork } from '@/lib/fork'
import { refusalResponse } from '@/lib/runSession'
import type { RunMeta } from '@/lib/types'

// A new run from this one: rerun from a node, or set revised outputs; either way their
// descendants rerun and the answered holds above them carry over (#103).
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ runId: string }> },
) {
  const { runId } = await params
  const body = await req.json().catch(() => ({}))

  let meta: RunMeta
  try {
    meta = readRunMeta(runId)
  } catch {
    return NextResponse.json({ error: 'Run not found' }, { status: 404 })
  }
  if (meta.status === 'running') {
    return NextResponse.json({ error: 'Run is running' }, { status: 409 })
  }

  const fork = planFork(meta, body ?? {})
  if ('error' in fork) return refusalResponse(fork)
  const res = forkRun(meta, fork)
  return 'error' in res ? refusalResponse(res) : res
}
