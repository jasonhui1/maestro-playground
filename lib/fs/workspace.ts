import { loadAllAgents, parseAgent } from './parseAgent'
import { loadAgentDefaults, readAgentDefaultsRaw } from './defaults'
import { loadAllSkills } from './parseSkill'
import { loadAllChains } from './parseChain'
import { loadAllTemplates } from './parseTemplate'
import { loadAllTools } from './parseTool'
import { discoverFiles, findBySlug } from './discover'
import { variantIndex, type VariantSource } from './variantIndex'
import { ENTITY_DIRS } from '../entityDirs'
import path from 'path'
import fs from 'fs'
import { WorkspaceError } from './errors'
import { knownModelCatalogue } from '../pricing'
import { resolveProvider } from '../provider'

export * from './errors'
export type { VariantSource }
export const ENTITY_TYPES = ENTITY_DIRS;

export type EntityType = keyof typeof ENTITY_TYPES;

export function isValidEntityType(type: string): type is EntityType {
  return type in ENTITY_TYPES;
}

export function sanitizeSlug(slug: string) {
  // Remove any path traversal characters and ensure it's just a filename
  return path.basename(slug).replace(/[^\w.-]/g, '')
}

// A folder is a location, never an identity, so it gets its own sanitiser instead of
// riding through sanitizeSlug — smuggling it through the slug would break ADR-0012's
// bare-slug reference rule.
export function sanitizeFolder(folder?: string) {
  if (!folder) return ''
  return folder
    .split('/')
    .map(segment => segment.replace(/[^\w.-]/g, ''))
    .filter(segment => segment && segment !== '.' && segment !== '..')
    .join('/')
}

export function resolveEntityPath(root: string, type: string, slug: string, folder?: string) {
  if (!isValidEntityType(type)) {
    throw new WorkspaceError('INVALID_NAME', `Invalid entity type: ${type}`)
  }

  const subDir = ENTITY_TYPES[type]
  const absoluteSubDir = path.join(root, subDir)
  if (!fs.existsSync(absoluteSubDir)) {
    fs.mkdirSync(absoluteSubDir, { recursive: true })
  }

  const safeSlug = sanitizeSlug(slug)
  const filename = safeSlug.toLowerCase().endsWith('.md') ? safeSlug : `${safeSlug}.md`
  // A slug addresses a file wherever it sits, so an existing file resolves to its own
  // path — rebuilding one from the slug would write a root twin of a file in a
  // sub-folder, and that twin then fails the load as a duplicate (ADR-0012).
  const existing = findBySlug(absoluteSubDir, path.basename(filename, '.md'))
  const targetPath = existing ?? path.join(root, subDir, sanitizeFolder(folder), filename)

  // Belt-and-suspenders: sanitizeFolder already strips every '..' segment, so this
  // should be unreachable, but a resolved path outside the type dir is unsafe enough
  // to guard against directly rather than trust that invariant alone.
  if (!targetPath.startsWith(absoluteSubDir)) {
    throw new WorkspaceError('SECURITY_VIOLATION', 'Security violation: Directory traversal detected')
  }

  return targetPath
}

/** Where a folder (not a file) should live under a type directory. Never creates it. */
export function resolveFolderPath(root: string, type: string, folder: string) {
  if (!isValidEntityType(type)) {
    throw new WorkspaceError('INVALID_NAME', `Invalid entity type: ${type}`)
  }

  const absoluteSubDir = path.join(root, ENTITY_TYPES[type])
  const targetPath = path.join(absoluteSubDir, sanitizeFolder(folder))

  if (!targetPath.startsWith(absoluteSubDir)) {
    throw new WorkspaceError('SECURITY_VIOLATION', 'Security violation: Directory traversal detected')
  }

  return targetPath
}

/** One agent, resolved against the workspace defaults file — never the raw agent file (ADR-0010). */
export function loadAgent(root: string, filePath: string) {
  return parseAgent(filePath, undefined, loadAgentDefaults(root))
}

// File path and storage slug; maps variants to declaring file (#118, #123).
export function resolveAddressedFile(
  root: string,
  type: EntityType,
  slug: string,
  variants?: Map<string, VariantSource>,
): { filePath: string; storageSlug: string } {
  if (type === 'agent') {
    const own = findBySlug(path.join(root, 'agents'), slug)
    if (own) return { filePath: own, storageSlug: slug }

    const hit = (variants ?? variantIndex(root, 'agent')).get(slug)
    if (hit) {
      return { filePath: hit.filePath, storageSlug: hit.fileSlug }
    }
  }
  return { filePath: resolveEntityPath(root, type, slug), storageSlug: slug }
}

export function findAgentFile(root: string, slug: string): string | undefined {
  const { filePath } = resolveAddressedFile(root, 'agent', slug)
  return fs.existsSync(filePath) ? filePath : undefined
}

export function declaringAgentSlug(root: string, slug: string): string | undefined {
  const { filePath, storageSlug } = resolveAddressedFile(root, 'agent', slug)
  return fs.existsSync(filePath) ? storageSlug : undefined
}

export function loadWorkspace(root: string) {
  const context = discoverFiles(path.join(root, 'context')).map(f => ({
    slug: f.slug,
    name: f.slug,
    filePath: f.filePath,
    rawContent: f.raw,
  }))

  const agents = loadAllAgents(root)
  return {
    agents,
    skills: loadAllSkills(root),
    chains: loadAllChains(root),
    templates: loadAllTemplates(root),
    tools: loadAllTools(root),
    context,
    defaults: loadAgentDefaults(root),
    defaultsRaw: readAgentDefaultsRaw(root),
    models: knownModelCatalogue(agents.map(a => a.model), resolveProvider().model),
    envModelOverride: process.env.AI_MODEL_OVERRIDE === 'true',
  }
}
