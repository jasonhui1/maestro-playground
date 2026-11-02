import type { AgentDef } from './types'
import { PRICED_MODELS } from './pricing'

/** `agent` as a run's model override has it run, leaving its definition untouched (#128). */
export function withModelOverride(agent: AgentDef, modelOverride: string | undefined): AgentDef {
  if (!modelOverride) return agent
  return {
    ...agent,
    model: modelOverride,
    resolution: {
      forbidden: agent.resolution?.forbidden ?? [],
      sources: {
        ...(agent.resolution?.sources ?? {}),
        model: 'run override',
      },
    } as AgentDef['resolution'],
  }
}

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
