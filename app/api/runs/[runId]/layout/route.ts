import { NextRequest, NextResponse } from 'next/server'
import { loadRunFor } from '@/lib/loadRun'
import { diskWorkspace } from '@/lib/runFolders'
import { toResponse } from '@/lib/refusal'
import { loadWorkspace } from '@/lib/fs/workspace'
import { findChainForRun } from '@/lib/resolveRunChain'
import { buildLayoutModel, LayoutModel } from '@/lib/layoutModel'

const UNDECLARED: LayoutModel = { kind: 'undeclared', panels: [] }

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ runId: string }> }
) {
  const { runId } = await params
  const meta = loadRunFor(diskWorkspace().runs, runId)
  if ('error' in meta) return toResponse(meta)

  const { chains } = loadWorkspace()
  // A chain renamed or deleted since the run happened resolves the same as one that
  // never declared a view (#72) — not a 404, the run itself was found.
  const chain = findChainForRun(chains, meta.chainName)
  const model = chain ? buildLayoutModel(chain, meta.agentOutputs) : UNDECLARED
  return NextResponse.json(model)
}
