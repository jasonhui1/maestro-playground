import { NextRequest, NextResponse } from 'next/server'
import { loadRunFor } from '@/lib/loadRun'
import { requestWorkspace } from '@/lib/requestWorkspace'
import { toResponse } from '@/lib/refusal'
import { parseVersionKey } from '@/lib/runVersions'
import { getVersionContent } from '@/lib/fs/versions'
import { changedSince, findPreviousRun } from '@/lib/changedSince'

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ runId: string }> }
) {
  const { runId } = await params
  const ws = requestWorkspace()
  const runMeta = loadRunFor(ws.runs, runId)
  if ('error' in runMeta) return toResponse(runMeta)

  const { searchParams } = new URL(req.url)
  const predecessorId = searchParams.get('predecessorId')

  let prevMeta = null
  if (predecessorId) {
    const loaded = loadRunFor(ws.runs, predecessorId)
    if ('error' in loaded) return toResponse(loaded)
    prevMeta = loaded
  } else {
    // #131: Deterministically discover previous run of the same chain
    const allRuns = ws.runs.list()
    prevMeta = findPreviousRun(allRuns, runMeta)
  }

  const getContent = (key: string, version: number) => {
    const { type, slug } = parseVersionKey(key)
    return getVersionContent(ws.root, type, slug, version)
  }

  const result = changedSince(prevMeta, runMeta, { getContent })
  return NextResponse.json(result)
}
