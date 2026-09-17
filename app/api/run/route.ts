import { NextRequest } from 'next/server'
import { loadWorkspace } from '@/lib/fs/workspace'
import { initRunDir, readRunMeta } from '@/lib/logger'
import { pinRunVersions, versionKey } from '@/lib/runVersions'
import { validateChain } from '@/lib/chainGraph'
import { RunMeta, AgentOutput, HoldRecord } from '@/lib/types'
import { resolveRunChain } from '@/lib/resolveRunChain'
import { streamChainRun, contextOverrides } from '@/lib/runSession'
import { holdLogExtras } from '@/lib/hold'
import { nanoid } from 'nanoid'
import path from 'path'

/**
 * Hold records along a branch's ancestry: a branch re-logs its source's answered holds,
 * and only the run that answered one keeps its record (#100).
 */
function lineageHolds(runId: string | undefined): HoldRecord[] {
  const holds: HoldRecord[] = []
  const seen = new Set<string>()
  while (runId && !seen.has(runId)) {
    seen.add(runId)
    let source: RunMeta
    try { source = readRunMeta(runId) } catch { break }
    holds.push(...(source.holds ?? []))
    runId = source.branchedFromRunId
  }
  return holds
}

export async function POST(req: NextRequest) {
  const body = await req.json()
  const { seedPrompt, branchedFromRunId, branchedFromStep, branchOutputs, paramValue, context } = body

  const workspace = loadWorkspace()
  const { agents, skills, chains, tools } = workspace

  const resolved = resolveRunChain(body, { agents, chains })
  if ('error' in resolved) return new Response(resolved.error, { status: resolved.status })
  const { chain, title: runTitle, kind } = resolved

  const validation = validateChain(chain, agents, chains, tools, skills)
  if (!validation.valid) {
    return new Response(JSON.stringify({ error: 'Invalid chain', errors: validation.errors }), {
      status: 400, headers: { 'Content-Type': 'application/json' },
    })
  }

  const versions = pinRunVersions(chain, workspace)
  // The scalar still names the entry point — the chain for a chain run, the agent
  // for an agent run — so a step log keeps the one number it has always carried.
  const currentVersion = versions[kind === 'agent' ? versionKey('agent', chain.slug) : versionKey('chain', chain.slug)] ?? 0

  const runId = `${new Date().toISOString().slice(0, 10)}-${nanoid(6)}`
  const meta: RunMeta = {
    runId,
    chainName: runTitle,
    seedPrompt,
    parameter: chain.parameter && paramValue ? { name: chain.parameter.name, value: paramValue } : undefined,
    startedAt: new Date().toISOString(),
    status: 'running',
    agentOutputs: [],
    graph: { nodes: chain.nodes, edges: chain.edges },
    branchedFromRunId: branchedFromRunId ? path.basename(branchedFromRunId) : undefined,
    branchedFromStep,
    versionNumber: currentVersion > 0 ? currentVersion : undefined,
    versions,
  }
  initRunDir(meta)

  const replay: AgentOutput[] = branchOutputs ?? []
  const sourceHolds = replay.length ? lineageHolds(meta.branchedFromRunId) : []

  return streamChainRun({
    runId,
    chain,
    workspace,
    seedPrompt,
    paramValue: typeof paramValue === 'string' ? paramValue : '',
    context: contextOverrides(context),
    replay,
    logExtras: holdLogExtras(replay, sourceHolds),
    versionNumber: currentVersion,
  })
}
