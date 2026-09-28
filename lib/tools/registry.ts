import { AgentDef, ToolDef } from '../types'
import { ExecutorId, JsonSchema, paramsToJsonSchema } from './spec'
import { retrieveExecutor } from './retrieveExecutor'
import { novelaiExecutor } from './novelaiExecutor'
import type { ToolContext } from './context'
import { openPartParams, resolveParts } from './parts'

/** A call's result for the model, and the images it saved (#148). */
export interface ToolOutcome {
  result: string
  images?: string[]
}

type ToolReturn = string | ToolOutcome

export interface BoundTool {
  def: ToolDef
  jsonSchema: JsonSchema
  execute: (params: Record<string, unknown>) => Promise<ToolReturn> | ToolReturn
}

/** One call's prompt parts in declared order, each already resolved to its value (#149). */
export type PromptParts = { name: string; value: string }[]

type ExecutorFn = (params: Record<string, unknown>, config: Record<string, unknown>, ctx: ToolContext, parts: PromptParts) => Promise<ToolReturn> | ToolReturn

const EXECUTORS: Record<ExecutorId, ExecutorFn> = {
  retrieve: (params, config, ctx) => retrieveExecutor(params, config, ctx.workspacePath),
  novelai: novelaiExecutor,
}

// Resolves an agent's tool refs (frontmatter `name`, per validateChain's toolByName map — same
// convention as injectSkills) into bound tools: definition + model-visible JSON Schema + a closed
// execute function. `config` is captured in the closure and never exposed on the BoundTool.
// Refs that don't resolve are dropped silently, mirroring injectSkills — validateChain already
// gates unresolvable refs before a run reaches this point.
export function bindAgentTools(agent: AgentDef, tools: ToolDef[], ctx: ToolContext): BoundTool[] {
  const byName = new Map(tools.map(t => [t.name, t]))
  const bound: BoundTool[] = []
  for (const ref of agent.tools ?? []) {
    const def = byName.get(ref)
    if (!def) continue
    const executor = EXECUTORS[def.executor as ExecutorId]
    if (!executor) continue
    const parts = def.parts ?? []
    const fixed = ctx.fixedParts?.[def.name]
    bound.push({
      def,
      jsonSchema: paramsToJsonSchema({ ...def.params, ...openPartParams(parts, fixed) }),
      execute: (params: Record<string, unknown>) => executor(params, def.config, ctx, resolveParts(parts, fixed, params)),
    })
  }
  return bound
}
