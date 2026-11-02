import { NextRequest, NextResponse } from 'next/server'
import { requestWorkspace } from '@/lib/requestWorkspace'
import { runIndex, type RunFilter, type RunSubjectKind } from '@/lib/runIndex'
import type { RunMeta } from '@/lib/types'
import type { Workspace } from '@/lib/runFolders'

/** An agent file's history is the runs it took part in; `kind` + `slug` lists one subject's runs (#168). */
function subjectFilter(ws: Workspace, params: URLSearchParams): RunFilter {
  const slug = params.get('slug')
  if (!slug) return {}
  const { agents, chains, tools } = ws.definitions()
  const entityType = params.get('entityType')
  const nameIn = (defs: { slug: string; name: string }[]) => defs.find(d => d.slug === slug)?.name
  if (entityType === 'agent') return { involving: { slug, name: nameIn(agents) } }
  const kind = (params.get('kind') ?? (entityType === 'chain' ? 'chain' : null)) as RunSubjectKind | null
  if (!kind) return {}
  const defs = { chain: chains, inline: chains, agent: agents, chat: agents, tool: tools }[kind] ?? []
  return { of: { kind, slug, name: nameIn(defs) } }
}

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url)
    const ws = requestWorkspace()
    const runs = runIndex(ws.runs).list({
      ...subjectFilter(ws, searchParams),
      title: searchParams.get('chainName') ?? undefined,
      status: (searchParams.get('status') as RunMeta['status'] | null) ?? undefined,
      keyword: searchParams.get('keyword') ?? undefined,
      branchedFromRunId: searchParams.get('branchedFromRunId') ?? undefined,
      varianceGroupId: searchParams.get('varianceGroupId') ?? undefined,
    })
    return NextResponse.json(runs)
  } catch (err: unknown) {
    const error = err as Error
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}
