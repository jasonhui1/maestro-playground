import { loadAllAgents, parseAgent } from './parseAgent'
import { loadAgentDefaults, readAgentDefaultsRaw } from './defaults'
import { loadAllSkills } from './parseSkill'
import { loadAllChains } from './parseChain'
import { loadAllTemplates } from './parseTemplate'
import { loadAllTools } from './parseTool'
import { loadDiscovered, findBySlug, relativePosix, type Loaded } from './discover'
import { variantIndex, type VariantSource } from './variantIndex'
import { ENTITY_DIRS } from '../entityDirs'
import path from 'path'
import fs from 'fs'
import { WorkspaceError } from './errors'
import { knownModelCatalogue } from '../pricing'
import { resolveProvider } from '../provider'
import type { NameClash, WorkspaceWarning } from '../types'

export * from './errors'
export type { VariantSource }
export const ENTITY_TYPES = ENTITY_DIRS;

export type EntityType = keyof typeof ENTITY_TYPES;

export function isValidEntityType(type: string): type is EntityType {
  return type in ENTITY_TYPES;
}

export function sanitizeSlug(slug: string) {
  // Filename leaf without .md agrees with workspace identity (ADR-0012, #159).
  const clean = path.basename(slug).replace(/[^\w.-]/g, '')
  return clean.toLowerCase().endsWith('.md') ? clean.slice(0, -3) : clean
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
  // sub-folder, and that twin would clash with it (ADR-0012, #151).
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
  const cleanSlug = sanitizeSlug(slug)
  if (type === 'agent') {
    const own = findBySlug(path.join(root, 'agents'), cleanSlug)
    if (own) return { filePath: own, storageSlug: cleanSlug }

    const hit = (variants ?? variantIndex(root, 'agent')).get(cleanSlug)
    if (hit) {
      return { filePath: hit.filePath, storageSlug: hit.fileSlug }
    }
  }
  return { filePath: resolveEntityPath(root, type, cleanSlug), storageSlug: cleanSlug }
}

export function findAgentFile(root: string, slug: string): string | undefined {
  const { filePath } = resolveAddressedFile(root, 'agent', slug)
  return fs.existsSync(filePath) ? filePath : undefined
}

export function declaringAgentSlug(root: string, slug: string): string | undefined {
  const { filePath, storageSlug } = resolveAddressedFile(root, 'agent', slug)
  return fs.existsSync(filePath) ? storageSlug : undefined
}

// A name that claims two sources warns rather than failing the load (#151).
function clashWarnings(root: string, entityType: EntityType, clashes: NameClash[]): WorkspaceWarning[] {
  const typeDir = path.join(root, ENTITY_TYPES[entityType])
  return clashes.map(({ name, paths }) => {
    const count = paths.length === 2 ? 'Two' : String(paths.length)
    const where = paths.map(p => relativePosix(typeDir, p)).join(', ')
    return { entityType, name, paths, message: `${count} ${entityType}s are named "${name}": ${where}` }
  })
}

export function loadWorkspace(root: string) {
  const loaded = {
    agent: loadAllAgents(root),
    skill: loadAllSkills(root),
    chain: loadAllChains(root),
    template: loadAllTemplates(root),
    tool: loadAllTools(root),
    context: loadDiscovered(path.join(root, ENTITY_TYPES.context), f => ({
      slug: f.slug,
      name: f.slug,
      filePath: f.filePath,
      rawContent: f.raw,
    })),
  } satisfies Record<EntityType, Loaded<unknown>>

  const warnings = (Object.keys(loaded) as EntityType[])
    .flatMap(type => clashWarnings(root, type, loaded[type].clashes))

  return {
    agents: loaded.agent.items,
    skills: loaded.skill.items,
    chains: loaded.chain.items,
    templates: loaded.template.items,
    tools: loaded.tool.items,
    context: loaded.context.items,
    warnings,
    defaults: loadAgentDefaults(root),
    defaultsRaw: readAgentDefaultsRaw(root),
    models: knownModelCatalogue(loaded.agent.items.map(a => a.model), resolveProvider().model),
    envModelOverride: process.env.AI_MODEL_OVERRIDE === 'true',
  }
}
