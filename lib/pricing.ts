// #126
const PRICING: Record<string, { input: number; output: number }> = {
  'anthropic/claude-3-opus':     { input: 0.000015,   output: 0.000075 },
  'anthropic/claude-3.5-sonnet': { input: 0.000003,   output: 0.000015 },
  'anthropic/claude-sonnet-4.5': { input: 0.000003,   output: 0.000015 },
  'openai/gpt-4o':               { input: 0.000005,   output: 0.000015 },
  'openai/gpt-4o-mini':          { input: 0.00000015, output: 0.00000060 },
  'gemma-4-31b-it':              { input: 0,          output: 0 },
}

const ALIASES: Record<string, string> = {
  'claude-3-opus': 'anthropic/claude-3-opus',
  'claude-3.5-sonnet': 'anthropic/claude-3.5-sonnet',
  'claude-sonnet-4.5': 'anthropic/claude-sonnet-4.5',
  'gpt-4o': 'openai/gpt-4o',
  'gpt-4o-mini': 'openai/gpt-4o-mini',
  'google/gemma-4-31b-it': 'gemma-4-31b-it',
}

function lookupPrice(model: string): { input: number; output: number } | undefined {
  const canonical = ALIASES[model] ?? model
  return PRICING[canonical]
}

export function isModelPriced(model: string): boolean {
  return lookupPrice(model) !== undefined
}

export function priceWarningFor(model: string): string | undefined {
  return isModelPriced(model) ? undefined : `no price for ${model}`
}

export function calcCost(model: string, tokensIn: number, tokensOut: number): number | undefined {
  const p = lookupPrice(model)
  if (!p) return undefined
  return p.input * tokensIn + p.output * tokensOut
}

export const PRICED_MODELS: string[] = Object.keys(PRICING)

export function parseModelOverride(val: unknown): { valid: true; value?: string | null } | { valid: false; error: string } {
  if (val === undefined) return { valid: true }
  if (val === null) return { valid: true, value: null }
  if (typeof val === 'string' && val.trim()) return { valid: true, value: val.trim() }
  return { valid: false, error: 'modelOverride must be a non-empty string or null' }
}

export function knownModelCatalogue(declaredModels: string[] = [], configuredModel?: string): string[] {
  const set = new Set<string>(PRICED_MODELS)
  if (configuredModel?.trim()) set.add(configuredModel.trim())
  for (const m of declaredModels) {
    if (m?.trim()) set.add(m.trim())
  }
  return Array.from(set)
}

export function resolveContinuationModelOverride(
  sourceOverride: string | undefined,
  requestOverride: string | null | undefined,
): string | undefined {
  if (requestOverride === undefined) return sourceOverride
  if (requestOverride === null) return undefined
  const clean = requestOverride.trim()
  return clean ? clean : sourceOverride
}

// #145
export function summarizeRunCost(outputs: Array<{ costUsd?: number; model?: string }>): {
  totalCost: number
  pricedCount: number
  unpricedCount: number
  unpricedModels: string[]
  /** Textual fallback for plain strings, exports, or non-rich renderings (#145). */
  formatted: string
} {
  let totalCost = 0
  let pricedCount = 0
  let unpricedCount = 0
  const unpricedSet = new Set<string>()

  for (const o of outputs) {
    if (typeof o.costUsd === 'number') {
      pricedCount++
      totalCost += o.costUsd
    } else {
      unpricedCount++
      if (o.model?.trim()) {
        unpricedSet.add(o.model.trim())
      }
    }
  }

  const unpricedModels = Array.from(unpricedSet)
  const formatted = pricedCount === 0
    ? 'unpriced'
    : unpricedCount > 0
      ? `$${totalCost.toFixed(4)} (+${unpricedCount} unpriced)`
      : `$${totalCost.toFixed(4)}`

  return {
    totalCost,
    pricedCount,
    unpricedCount,
    unpricedModels,
    formatted,
  }
}
