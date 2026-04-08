import { loadAllAgents } from './parseAgent'
import { loadAllSkills } from './parseSkill'
import { loadAllChains } from './parseChain'
import { loadAllTemplates } from './parseTemplate'
import path from 'path'

const WORKSPACE = process.env.WORKSPACE_PATH ?? './workspace'

export function getWorkspacePath() {
  return path.resolve(WORKSPACE)
}

export function sanitizeSlug(slug: string) {
  // Remove any path traversal characters and ensure it's just a filename
  return path.basename(slug).replace(/[^\w.-]/g, '')
}

export function resolveEntityPath(type: string, slug: string) {
  const wp = getWorkspacePath()
  const subDir = type === 'agent' ? 'agents' : type === 'skill' ? 'skills' : type === 'chain' ? 'chains' : type === 'template' ? 'templates' : ''
  if (!subDir) throw new Error(`Invalid entity type: ${type}`)
  
  const safeSlug = sanitizeSlug(slug)
  const targetPath = path.join(wp, subDir, `${safeSlug}.md`)
  
  // Security check: Ensure the resolved path is still within the workspace subdirectory
  const absoluteSubDir = path.join(wp, subDir)
  if (!targetPath.startsWith(absoluteSubDir)) {
    throw new Error('Security violation: Directory traversal detected')
  }
  
  return targetPath
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
