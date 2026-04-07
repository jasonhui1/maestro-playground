import { NextRequest, NextResponse } from 'next/server'
import { listAllRuns } from '@/lib/logger'

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url)
    const chainName = searchParams.get('chainName')
    const status = searchParams.get('status')
    const keyword = searchParams.get('keyword')

    let runs = listAllRuns()

    // Sort by startedAt descending
    runs.sort((a, b) => new Date(b.startedAt).getTime() - new Date(a.startedAt).getTime())

    if (chainName) {
      runs = runs.filter(r => r.chainName === chainName)
    }

    if (status) {
      runs = runs.filter(r => r.status === status)
    }

    if (keyword) {
      const kw = keyword.toLowerCase()
      runs = runs.filter(r => 
        r.seedPrompt.toLowerCase().includes(kw) || 
        r.runId.toLowerCase().includes(kw)
      )
    }

    return NextResponse.json(runs)
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
