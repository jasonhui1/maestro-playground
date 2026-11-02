import { NextRequest, NextResponse } from 'next/server'
import { requestWorkspace } from '@/lib/requestWorkspace'
import { runIndex, type RunFilter, type RunSubjectKind } from '@/lib/runIndex'
import type { RunMeta } from '@/lib/types'
import type { Workspace } from '@/lib/runFolders'

const SUBJECT_KINDS: RunSubjectKind[] = ['chain', 'agent', 'tool', 'chat', 'inline']

/**
 * `entityType` + `slug` is a workspace file's history: the runs an agent took part in, or
 * a chain's runs. `kind` + `slug` is the runs of one subject. Names find older runs (#168).
 */
function subjectFilter(ws: Workspace, params: URLSearchParams): RunFilter {
  const slug = params.get('slug')
  if (!slug) return {}
  const { agents, chains } = ws.definitions()
  const agentName = () => agents.find(a => a.slug === slug)?.name
  const entityType = params.get('entityType')
  if (entityType === 'agent') return { involving: { slug, name: agentName() } }
  if (entityType === 'chain') return { of: { kind: 'chain', slug, name: chains.find(c => c.slug === slug)?.name } }
  const kind = params.get('kind') as RunSubjectKind | null
  if (kind === 'chat' || kind === 'agent') return { of: { kind, slug, name: agentName() } }
  if (kind && SUBJECT_KINDS.includes(kind)) return { of: { kind, slug } }
  return {}
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
