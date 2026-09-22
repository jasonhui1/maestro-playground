import type { AgentDef } from './types'

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
