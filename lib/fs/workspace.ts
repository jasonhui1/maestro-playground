import { loadAllAgents, parseAgent } from './parseAgent'
import { loadAgentDefaults } from './defaults'
import { loadAllSkills } from './parseSkill'
import { loadAllChains } from './parseChain'
import { loadAllTemplates } from './parseTemplate'
import { loadAllTools } from './parseTool'
import { discoverFiles, findBySlug } from './discover'
import path from 'path'
import fs from 'fs'


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
  // Read per call, not once at import: the workspace root must stay overridable
  // after this module is loaded.
  return path.resolve(process.env.WORKSPACE_PATH ?? './workspace')
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
  // A slug addresses a file wherever it sits, so an existing file resolves to its own
  // path — rebuilding one from the slug would write a root twin of a file in a
  // sub-folder, and that twin then fails the load as a duplicate (ADR-0012).
  const existing = findBySlug(absoluteSubDir, path.basename(filename, '.md'))
  const targetPath = existing ?? path.join(wp, subDir, filename)

  // Security check: Ensure the resolved path is still within the workspace subdirectory
  if (!targetPath.startsWith(absoluteSubDir)) {
    throw new Error('Security violation: Directory traversal detected')
  }
  
  return targetPath
}

/** One agent, resolved against the workspace defaults file — never the raw agent file (ADR-0010). */
export function loadAgent(filePath: string) {
  return parseAgent(filePath, undefined, loadAgentDefaults(getWorkspacePath()))
}

export function loadWorkspace() {
  const wp = getWorkspacePath()
  
  const context = discoverFiles(path.join(wp, 'context')).map(f => ({
    slug: f.slug,
    name: f.slug,
    filePath: f.filePath,
    rawContent: f.raw,
  }))

  return {
    agents: loadAllAgents(wp),
    skills: loadAllSkills(wp),
    chains: loadAllChains(wp),
    templates: loadAllTemplates(wp),
    tools: loadAllTools(wp),
    context,
  }
}
