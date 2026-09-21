import { NextRequest, NextResponse } from 'next/server'
import { loadRunFor } from '@/lib/loadRun'
import { requestWorkspace } from '@/lib/requestWorkspace'
import { badRequest, notFound, toResponse } from '@/lib/refusal'
import { buildForkComparison } from '@/lib/forkComparison'

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ runId: string }> }
) {
  const { runId } = await params
  const ws = requestWorkspace()
  const forkMeta = loadRunFor(ws.runs, runId)
  if ('error' in forkMeta) return toResponse(forkMeta)

  if (!forkMeta.branchedFromRunId && !forkMeta.forkAnchors) {
    return toResponse(badRequest('Run is not a fork'))
  }

  let sourceMeta = null
  if (forkMeta.branchedFromRunId) {
    try {
      sourceMeta = ws.runs.read(forkMeta.branchedFromRunId)
    } catch {
      // Source run may have been deleted; if sourceOutputs exists in forkMeta, comparison succeeds (#130).
    }
  }

  if (!forkMeta.sourceOutputs && !sourceMeta) {
    return toResponse(notFound('Source run not found'))
  }

  const comparison = buildForkComparison(forkMeta, sourceMeta)
  return NextResponse.json(comparison)
}
