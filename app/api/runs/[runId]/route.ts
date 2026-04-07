import { NextRequest, NextResponse } from 'next/server'
import { readRunMeta } from '@/lib/logger'

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ runId: string }> }
) {
  const { runId } = await params
  try {
    const meta = readRunMeta(runId)
    return NextResponse.json(meta)
  } catch (error) {
    return NextResponse.json({ error: 'Run not found' }, { status: 404 })
  }
}
