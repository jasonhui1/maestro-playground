import { NextRequest } from 'next/server'
import { startRun } from '@/lib/runSession'
import { requestWorkspace } from '@/lib/requestWorkspace'
import { prepareRunRequest, retiredBranchRefusal, type RunRequestBody } from '@/lib/runRequest'

export async function POST(req: NextRequest) {
  const body = await req.json()
  // Refused, not ignored: an old client would otherwise rerun the whole chain (#103).
  const retired = retiredBranchRefusal(body)
  if (retired) return Response.json({ error: retired.error }, { status: retired.status })
  const ws = requestWorkspace()
  const prepared = prepareRunRequest(ws, body as RunRequestBody)
  if ('error' in prepared) {
    return new Response(prepared.errors ? JSON.stringify({ error: prepared.error, errors: prepared.errors }) : JSON.stringify({ error: prepared.error }), {
      status: prepared.status, headers: { 'Content-Type': 'application/json' },
    })
  }
  return startRun(ws, prepared.input)
}
