import { NextRequest, NextResponse } from 'next/server'
import { loadRunFor } from '@/lib/loadRun'
import { requestWorkspace } from '@/lib/requestWorkspace'
import { toResponse } from '@/lib/refusal'
import { runChain } from '@/lib/runIndex'
import { buildLayoutModel, LayoutModel } from '@/lib/layoutModel'

const UNDECLARED: LayoutModel = { kind: 'undeclared', panels: [] }

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ runId: string }> }
) {
  const { runId } = await params
  const ws = requestWorkspace()
  const meta = loadRunFor(ws.runs, runId)
  if ('error' in meta) return toResponse(meta)

  const { chains } = ws.definitions()
  // A chain renamed or deleted since the run happened resolves the same as one that
  // never declared a view (#72) — not a 404, the run itself was found.
  const chain = runChain(meta, chains)
  // The recorded graph's nodes, so a node renamed or rekinded since still reads as it ran (#166).
  const model = chain
    ? buildLayoutModel(meta.graph ? { ...chain, nodes: meta.graph.nodes } : chain, meta.agentOutputs, meta.dice)
    : UNDECLARED
  return NextResponse.json(model)
}
