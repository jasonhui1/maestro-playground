import type { NextRequest } from 'next/server'
import { requestWorkspace } from '@/lib/requestWorkspace'
import { buildVarianceGroup } from '@/lib/variance'

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ groupId: string }> },
) {
  const { groupId } = await params
  const runs = requestWorkspace().runs.list().filter(run => run.variance?.groupId === groupId)
  if (runs.length === 0) return Response.json({ error: 'Variance group not found' }, { status: 404 })
  return Response.json(buildVarianceGroup(runs))
}
