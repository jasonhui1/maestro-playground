import { loadAllAgents } from './parseAgent'
import { loadAllSkills } from './parseSkill'
import { loadAllChains } from './parseChain'
import { loadAllTemplates } from './parseTemplate'
import { loadAllTools } from './parseTool'
import path from 'path'
import fs from 'fs'

const WORKSPACE = process.env.WORKSPACE_PATH ?? './workspace'

export const ENTITY_TYPES = {
  agent: 'agents',
  skill: 'skills',
  chain: 'chains',
  template: 'templates',
  context: 'context'
} as const;

export type EntityType = keyof typeof ENTITY_TYPES;

export function isValidEntityType(type: string): type is EntityType {
  return type in ENTITY_TYPES;
}

export function getWorkspacePath() {
  return path.resolve(WORKSPACE)
}

export function sanitizeSlug(slug: string) {
  // Remove any path traversal characters and ensure it's just a filename
  return path.basename(slug).replace(/[^\w.-]/g, '')
}

export function resolveEntityPath(type: string, slug: string) {
  const wp = getWorkspacePath()
  if (!isValidEntityType(type)) {
    throw new Error(`Invalid entity type: ${type}`)
  }
  
  const subDir = ENTITY_TYPES[type]
  const absoluteSubDir = path.join(wp, subDir)
  if (!fs.existsSync(absoluteSubDir)) {
    fs.mkdirSync(absoluteSubDir, { recursive: true })
  }

  const safeSlug = sanitizeSlug(slug)
  const filename = safeSlug.toLowerCase().endsWith('.md') ? safeSlug : `${safeSlug}.md`
  const targetPath = path.join(wp, subDir, filename)
  
  // Security check: Ensure the resolved path is still within the workspace subdirectory
  if (!targetPath.startsWith(absoluteSubDir)) {
    throw new Error('Security violation: Directory traversal detected')
  }
  
  return targetPath
}

export function loadWorkspace() {
  const wp = getWorkspacePath()
  
  const contextDir = path.join(wp, 'context')
  const context = fs.existsSync(contextDir) 
    ? fs.readdirSync(contextDir)
        .filter(f => f.endsWith('.md'))
        .map(f => ({
          slug: path.basename(f, '.md'),
          name: path.basename(f, '.md'),
          filePath: path.join(contextDir, f)
        }))
    : []

  return {
    agents: loadAllAgents(wp),
    skills: loadAllSkills(wp),
    chains: loadAllChains(wp),
    templates: loadAllTemplates(wp),
    tools: loadAllTools(wp),
    context,
  }
}
