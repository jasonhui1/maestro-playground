import { loadAllAgents } from './parseAgent'
import { loadAllSkills } from './parseSkill'
import { loadAllChains } from './parseChain'
import { loadAllTemplates } from './parseTemplate'
import path from 'path'

const WORKSPACE = process.env.WORKSPACE_PATH ?? './workspace'

export function getWorkspacePath() {
  return path.resolve(WORKSPACE)
}

export function loadWorkspace() {
  const wp = getWorkspacePath()
  return {
    agents: loadAllAgents(wp),
    skills: loadAllSkills(wp),
    chains: loadAllChains(wp),
    templates: loadAllTemplates(wp),
  }
}
