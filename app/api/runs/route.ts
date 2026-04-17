import { NextRequest, NextResponse } from 'next/server'
import { listAllRuns } from '@/lib/logger'

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url)
    const chainName = searchParams.get('chainName')
    const status = searchParams.get('status')
    const keyword = searchParams.get('keyword')
    const entityType = searchParams.get('entityType')
    const slug = searchParams.get('slug')

    let runs = listAllRuns()

    // Sort by startedAt descending
    runs.sort((a, b) => new Date(b.startedAt).getTime() - new Date(a.startedAt).getTime())

    if (chainName) {
      runs = runs.filter(r => r.chainName === chainName)
    }

    if (entityType && slug) {
      if (entityType === 'agent') {
        runs = runs.filter(r => r.agentOutputs.some(o => o.agentName === slug))
      } else if (entityType === 'chain') {
        runs = runs.filter(r => r.chainName === slug)
      }
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
  } catch (err: unknown) {
    const error = err as Error
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}
