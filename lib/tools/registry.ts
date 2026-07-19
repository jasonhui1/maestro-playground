import { AgentDef, ToolDef } from '../types'
import { ExecutorId, JsonSchema, paramsToJsonSchema } from './spec'
import { retrieveExecutor } from './retrieveExecutor'

export interface BoundTool {
  def: ToolDef
  jsonSchema: JsonSchema
  execute: (params: Record<string, unknown>) => Promise<string> | string
}

type ExecutorFn = (params: Record<string, unknown>, config: Record<string, unknown>, workspacePath: string) => Promise<string> | string

const EXECUTORS: Record<ExecutorId, ExecutorFn> = {
  retrieve: retrieveExecutor,
}

// Resolves an agent's tool refs (frontmatter `name`, per validateChain's toolByName map — same
// convention as injectSkills) into bound tools: definition + model-visible JSON Schema + a closed
// execute function. `config` is captured in the closure and never exposed on the BoundTool.
// Refs that don't resolve are dropped silently, mirroring injectSkills — validateChain already
// gates unresolvable refs before a run reaches this point.
export function bindAgentTools(agent: AgentDef, tools: ToolDef[], workspacePath: string): BoundTool[] {
  const byName = new Map(tools.map(t => [t.name, t]))
  const bound: BoundTool[] = []
  for (const ref of agent.tools ?? []) {
    const def = byName.get(ref)
    if (!def) continue
    const executor = EXECUTORS[def.executor as ExecutorId]
    if (!executor) continue
    bound.push({
      def,
      jsonSchema: paramsToJsonSchema(def.params),
      execute: (params: Record<string, unknown>) => executor(params, def.config, workspacePath),
    })
  }
  return bound
}
