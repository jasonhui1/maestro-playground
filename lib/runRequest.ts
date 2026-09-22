import { validateChain } from './chainGraph'
import { parseModelOverride } from './pricing'
import { resolveRunChain, type RunChainBody } from './resolveRunChain'
import { pinRunSnapshot, versionKey } from './runVersions'
import type { StartRunInput } from './runSession'
import type { Workspace } from './runFolders'
import type { Refusal } from './types'

export type RunRequestBody = RunChainBody & {
  seedPrompt?: string
  paramValue?: string
  context?: unknown
  modelOverride?: unknown
  chainSlug?: string
}

const RETIRED_BRANCH_FIELDS = ['branchOutputs', 'branchedFromRunId', 'branchedFromStep'] as const

export function retiredBranchRefusal(body: Record<string, unknown>): Refusal | null {
  return RETIRED_BRANCH_FIELDS.some(field => body[field] !== undefined)
    ? { error: 'Branch fields are retired; fork through POST /api/runs/:id/fork', status: 400 }
    : null
}

/** Resolve and pin one launch request once, so repeated runs share the same files. */
export function prepareRunRequest(ws: Workspace, body: RunRequestBody): { input: StartRunInput } | Refusal {
  const parsedOverride = parseModelOverride(body.modelOverride)
  if (!parsedOverride.valid) return { error: parsedOverride.error, status: 400 }
  const cleanOverride = parsedOverride.value ?? undefined

  const workspace = ws.definitions()
  const { agents, chains } = workspace
  const resolved = resolveRunChain(body, { agents, chains })
  if ('error' in resolved) return resolved
  const { chain, title, kind } = resolved

  const validation = validateChain(chain, workspace)
  if (!validation.valid) return { error: 'Invalid chain', status: 400, errors: validation.errors }

  const snapshot = pinRunSnapshot(ws.root, chain, workspace)
  const versions = snapshot.versions
  const versionNumber = versions[kind === 'agent'
    ? versionKey('agent', chain.slug)
    : versionKey('chain', chain.slug)] ?? 0
  const slug = typeof body.chainSlug === 'string'
    ? body.chainSlug
    : typeof body.slug === 'string'
      ? body.slug
      : (kind !== 'inline' ? chain.slug : undefined)

  return {
    input: {
      chain,
      workspace,
      title,
      seedPrompt: typeof body.seedPrompt === 'string' ? body.seedPrompt : '',
      parameter: chain.parameter && typeof body.paramValue === 'string' && body.paramValue
        ? { name: chain.parameter.name, value: body.paramValue }
        : undefined,
      context: body.context,
      pinnedContext: snapshot.context,
      versions,
      versionNumber,
      modelOverride: cleanOverride,
      chainSlug: slug,
      entrypoint: slug ? { kind, slug } : (kind === 'inline' ? { kind: 'inline' } : undefined),
    },
  }
}
