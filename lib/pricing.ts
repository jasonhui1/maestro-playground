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

// #128
export const PRICED_MODELS: string[] = Object.keys(PRICING)

// #128
export function knownModelCatalogue(declaredModels: string[] = [], configuredModel?: string): string[] {
  const set = new Set<string>(PRICED_MODELS)
  if (configuredModel?.trim()) set.add(configuredModel.trim())
  for (const m of declaredModels) {
    if (m?.trim()) set.add(m.trim())
  }
  return Array.from(set)
}

// #128
export function resolveContinuationModelOverride(
  sourceOverride: string | undefined,
  requestOverride: string | null | undefined,
): string | undefined {
  if (requestOverride === undefined) return sourceOverride
  if (requestOverride === null) return undefined
  const clean = requestOverride.trim()
  return clean ? clean : sourceOverride
}

