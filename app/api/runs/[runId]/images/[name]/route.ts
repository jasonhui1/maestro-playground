import { NextRequest, NextResponse } from 'next/server'
import { loadRunFor } from '@/lib/loadRun'
import { requestWorkspace } from '@/lib/requestWorkspace'
import { toResponse } from '@/lib/refusal'

// An image a run's tool saved (#148); a saved name is never rewritten, so it caches forever.
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ runId: string; name: string }> }
) {
  const { runId, name } = await params
  const ws = requestWorkspace()
  const meta = loadRunFor(ws.runs, runId)
  if ('error' in meta) return toResponse(meta)
  const bytes = ws.runs.readImage(meta.runId, name)
  if (!bytes) return NextResponse.json({ error: `No image ${name} in run ${runId}` }, { status: 404 })
  return new NextResponse(new Uint8Array(bytes), {
    headers: { 'Content-Type': 'image/webp', 'Cache-Control': 'public, max-age=31536000, immutable' },
  })
}
