import { NextRequest } from 'next/server'
import { pinRunVersions, versionKey } from '@/lib/runVersions'
import { validateChain } from '@/lib/chainGraph'
import { resolveRunChain } from '@/lib/resolveRunChain'
import { startRun } from '@/lib/runSession'
import { requestWorkspace } from '@/lib/requestWorkspace'

export async function POST(req: NextRequest) {
  const body = await req.json()
  const { seedPrompt, paramValue, context, modelOverride } = body
  // Refused, not ignored: an old client would otherwise rerun the whole chain (#103).
  if (['branchOutputs', 'branchedFromRunId', 'branchedFromStep'].some(field => body[field] !== undefined)) {
    return Response.json({ error: 'Branch fields are retired; fork through POST /api/runs/:id/fork' }, { status: 400 })
  }
  if (modelOverride !== undefined && modelOverride !== null) {
    if (typeof modelOverride !== 'string' || !modelOverride.trim()) {
      return Response.json({ error: 'modelOverride must be a non-empty string or null' }, { status: 400 })
    }
  }
  const cleanOverride = typeof modelOverride === 'string' && modelOverride.trim() ? modelOverride.trim() : undefined

  const ws = requestWorkspace()
  const workspace = ws.definitions()
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

  const versions = pinRunVersions(ws.root, chain, workspace)
  // The scalar still names the entry point — the chain for a chain run, the agent
  // for an agent run — so a step log keeps the one number it has always carried.
  const currentVersion = versions[kind === 'agent' ? versionKey('agent', chain.slug) : versionKey('chain', chain.slug)] ?? 0

  return startRun(ws, {
    chain, workspace, title: runTitle, seedPrompt,
    parameter: chain.parameter && typeof paramValue === 'string' && paramValue
      ? { name: chain.parameter.name, value: paramValue } : undefined,
    context, versions, versionNumber: currentVersion,
    modelOverride: cleanOverride,
  })
}
