import { validateChain } from './chainGraph'
import { parseModelOverride } from './pricing'
import { parseImageOverride } from './imageOverride'
import { resolveRunChain, type RunChainBody, type ResolvedRunKind } from './resolveRunChain'
import { pinRunSnapshot } from './runVersions'
import { versionKey } from './runVersionModel'
import { badRequest } from './refusal'
import { readDicePins } from './dice'
import type { StartRunInput } from './runSession'
import type { Workspace } from './runFolders'
import type { ChainDef, Refusal } from './types'

export type RunRequestBody = RunChainBody & {
  seedPrompt?: string
  inputs?: unknown
  dice?: unknown
  paramValue?: string
  context?: unknown
  modelOverride?: unknown
  imageOverride?: unknown
  chainSlug?: string
}

/** `null` leaves a port unset; tool runs also accept numeric and boolean settings (#157). */
export function readRunInputs(chain: ChainDef, inputs: unknown, kind: ResolvedRunKind): { inputs?: Record<string, string> } | Refusal {
  if (inputs === undefined) return {}
  if (!inputs || typeof inputs !== 'object' || Array.isArray(inputs)
    || !Object.values(inputs).every(v => v === null || typeof v === 'string'
      || (kind === 'tool' && (typeof v === 'boolean' || (typeof v === 'number' && Number.isFinite(v)))))) {
    return badRequest(kind === 'tool'
      ? 'inputs must map input names to text, finite numbers, booleans or null'
      : 'inputs must map input names to text or null')
  }
  const given: Record<string, string> = {}
  for (const [name, value] of Object.entries(inputs as Record<string, string | number | boolean | null>)) {
    if (!chain.inputs?.some(p => p.name === name)) {
      return badRequest(kind === 'tool'
        ? `Tool "${chain.slug}" has no input named "${name}"`
        : kind === 'agent'
        ? `Agent "${chain.slug}" has no prompt slot named "${name}"`
        : `Chain "${chain.slug}" declares no input named "${name}"`)
    }
    if (value !== null) given[name] = String(value)
  }
  return Object.keys(given).length ? { inputs: given } : {}
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
  const imageOverride = parseImageOverride(body.imageOverride)
  if (!imageOverride.valid) return { error: imageOverride.error, status: 400 }

  const workspace = ws.definitions()
  const resolved = resolveRunChain(body, workspace)
  if ('error' in resolved) return resolved
  const { chain, title, kind } = resolved

  const validation = validateChain(chain, workspace)
  if (!validation.valid) return { error: 'Invalid chain', status: 400, errors: validation.errors }

  const runInputs = readRunInputs(chain, body.inputs, kind)
  if ('error' in runInputs) return runInputs
  if (kind === 'tool') {
    const def = workspace.tools.find(t => t.slug === chain.slug)!
    const inputs = { ...runInputs.inputs }
    for (const part of def.parts ?? []) {
      if (!Object.hasOwn(inputs, part.name) && part.default !== undefined) inputs[part.name] = part.default
    }
    runInputs.inputs = inputs
  }
  const dice = readDicePins(body.dice, chain, workspace)
  if ('error' in dice) return dice

  const snapshot = pinRunSnapshot(ws.root, chain, workspace)
  const versions = snapshot.versions
  const versionNumber = versions[kind === 'agent' || kind === 'tool'
    ? versionKey(kind, chain.slug)
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
      seedPrompt: kind !== 'tool' && typeof body.seedPrompt === 'string' ? body.seedPrompt : '',
      inputs: runInputs.inputs,
      dicePins: dice.pins,
      parameter: chain.parameter && typeof body.paramValue === 'string' && body.paramValue
        ? { name: chain.parameter.name, value: body.paramValue }
        : undefined,
      context: body.context,
      pinnedContext: snapshot.context,
      versions,
      versionNumber,
      modelOverride: cleanOverride,
      imageOverride: imageOverride.value,
      chainSlug: slug,
      entrypoint: slug ? { kind, slug } : (kind === 'inline' ? { kind: 'inline' } : undefined),
    },
  }
}
