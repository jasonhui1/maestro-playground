import { NextRequest, NextResponse } from 'next/server'
import { loadRunFor } from '@/lib/loadRun'
import { requestWorkspace } from '@/lib/requestWorkspace'
import { toResponse } from '@/lib/refusal'
import { parseVersionKey } from '@/lib/runVersionModel'
import { changedSince } from '@/lib/changedSince'
import { runIndex } from '@/lib/runIndex'

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ runId: string }> }
) {
  const { runId } = await params
  const ws = requestWorkspace()
  const runMeta = loadRunFor(ws.runs, runId)
  if ('error' in runMeta) return toResponse(runMeta)

  const prevMeta = runIndex(ws.runs).previous(runMeta)

  const getContent = (key: string, version: number) => {
    const { type, slug } = parseVersionKey(key)
    return ws.versions.read(type, slug, version)
  }

  const result = changedSince(prevMeta, runMeta, { getContent })
  return NextResponse.json(result)
}
