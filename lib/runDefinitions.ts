import type { AgentDef, ChainDef, SkillDef, ToolDef } from './types'

/** The definitions a run reads: the loaded workspace files, minus the run folders. */
export interface RunDefinitions {
  agents: AgentDef[]
  skills: SkillDef[]
  chains: ChainDef[]
  tools: ToolDef[]
}
