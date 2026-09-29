import type { AgentDef, ChainDef, SkillDef, ToolDef, WorkspaceWarning } from './types'

/** The definitions a run reads: the loaded workspace files, minus the run folders. */
export interface RunDefinitions {
  agents: AgentDef[]
  skills: SkillDef[]
  chains: ChainDef[]
  tools: ToolDef[]
  /** Names discovery left out for clashing with another file or variant (#151). */
  warnings?: WorkspaceWarning[]
}
