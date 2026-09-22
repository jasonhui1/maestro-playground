import type { NextRequest } from 'next/server'
import { nanoid } from 'nanoid'
import { requestWorkspace } from '@/lib/requestWorkspace'
import { prepareRunRequest, retiredBranchRefusal, type RunRequestBody } from '@/lib/runRequest'
import { startRun } from '@/lib/runSession'
import { streamRun } from '@/lib/runStream'
import { sseResponse } from '@/lib/sse'

export async function POST(req: NextRequest) {
  const body = await req.json() as RunRequestBody & { count?: unknown }
  const retired = retiredBranchRefusal(body as Record<string, unknown>)
  if (retired) return Response.json({ error: retired.error }, { status: retired.status })
  const count = typeof body.count === 'number' ? body.count : Number.NaN
  if (!Number.isInteger(count) || count < 2 || count > 10) {
    return Response.json({ error: 'count must be an integer from 2 to 10' }, { status: 400 })
  }

  const ws = requestWorkspace()
  const prepared = prepareRunRequest(ws, body)
  if ('error' in prepared) {
    return Response.json(prepared.errors
      ? { error: prepared.error, errors: prepared.errors }
      : { error: prepared.error }, { status: prepared.status })
  }

  const groupId = `${new Date().toISOString().slice(0, 10)}-${nanoid(8)}`
  const responses = Array.from({ length: count }, (_, index) => startRun(ws, {
    ...prepared.input,
    variance: { groupId, index, size: count },
  }))

  return sseResponse(async send => {
    const runIds = new Array<string>(count)
    await Promise.all(responses.map(async (response, instance) => {
      const reader = response.body?.getReader()
      if (!reader) return
      await streamRun<Record<string, unknown>>(reader, event => {
        if (event.type === 'run_start' && typeof event.runId === 'string') runIds[instance] = event.runId
        send({ ...event, instance })
      })
    }))
    send({ type: 'variance_complete', groupId, runIds })
  })
}
