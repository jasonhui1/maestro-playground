// Pure and client-safe: the canvas draws part sockets from here (#149).
import type { AgentDef, ToolDef, ToolParamDef, ToolPartDef } from '../types'

/** A part as an agent node's input socket: `novelai.character`. Prompt slots never hold a dot, so the two can't collide. */
export function partSocket(tool: string, part: string): string {
  return `${tool}.${part}`
}

/** Every part socket an agent node carries, from the tools its agent file names, in tool then part order. */
export function agentPartSockets(agent: AgentDef, tools: ToolDef[]): { tool: string; part: string; socket: string }[] {
  const byName = new Map(tools.map(t => [t.name, t]))
  return (agent.tools ?? []).flatMap(ref => {
    const tool = byName.get(ref)
    return (tool?.parts ?? []).map(p => ({ tool: tool!.name, part: p.name, socket: partSocket(tool!.name, p.name) }))
  })
}

/** Parts neither the node nor the tool file fixes: the agent writes these. */
export function openParts(parts: ToolPartDef[], fixed: Record<string, string> = {}): ToolPartDef[] {
  return parts.filter(p => !Object.hasOwn(fixed, p.name) && p.default === undefined)
}

/** Open parts as model-facing params, so the model is asked for exactly what nothing fixed. */
export function openPartParams(parts: ToolPartDef[], fixed?: Record<string, string>): Record<string, ToolParamDef> {
  return Object.fromEntries(openParts(parts, fixed).map(p => [p.name, {
    type: 'string' as const,
    description: p.description ?? `Tags for the ${p.name}.`,
    required: true,
  }]))
}

/** Each part's value for one call, in declared order: node-fixed, else default, else what the model passed. */
export function resolveParts(parts: ToolPartDef[], fixed: Record<string, string> = {}, params: Record<string, unknown> = {}): { name: string; value: string }[] {
  return parts.map(p => {
    const passed = params[p.name]
    const value = Object.hasOwn(fixed, p.name) ? fixed[p.name]
      : p.default !== undefined ? p.default
      : typeof passed === 'string' ? passed : ''
    return { name: p.name, value: value.trim() }
  })
}
