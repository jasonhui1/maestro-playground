import matter from 'gray-matter'
import fs from 'fs'
import yaml from 'js-yaml'
import path from 'path'
import { resolveEntityPath, resolveFolderPath, sanitizeSlug, sanitizeFolder, ENTITY_TYPES, EntityType } from './workspace'
import { WorkspaceError, WorkspaceSaveConflict } from './errors'
import { addressExisting, type Address } from './address'
import { validateYaml } from './validate'
import { getAgentTemplate, getSkillTemplate, getChainTemplate, getTemplateTemplate, getToolTemplate } from './templates'
import { CreationParams } from '../types'
import { walkMarkdown, relativePosix } from './discover'
import { normalizeVariants } from './parseAgent'
import { declaredVariants } from './variantIndex'
import { ENTITY_DIRS } from '../entityDirs'

export interface SaveEntityRequest {
  type: EntityType
  slug: string
  data: Record<string, unknown>
  content: string
  folder?: string
  /** Omitted: legacy unconditional save. Null: create only. String: exact approved file text. */
  expectedRaw?: string | null
}

/** The file text for a save. The one place frontmatter is validated (#164). */
function fileText(data: Record<string, unknown>, content: string) {
  const validation = validateYaml(yaml.dump(data))
  if (!validation.valid) {
    throw new WorkspaceError('INVALID_CONTENT', `Invalid YAML frontmatter: ${validation.error}`)
  }
  return matter.stringify(content, data)
}

/** The names an agent file answers to: its variants, or its own slug when it has none (ADR-0013). */
function agentNamesOf(filePath: string): string[] {
  const variants = declaredVariants(filePath)
  return variants.length ? variants : [path.basename(filePath, '.md')]
}

// File names and variant ids share one namespace (ADR-0012), so a save may not newly
// claim a name another agent file already claims — clashing or not (#151).
function assertAgentNamesFree(root: string, filePath: string, slug: string, rawVariants: unknown) {
  let variants
  try {
    variants = normalizeVariants(rawVariants, filePath)
  } catch {
    return // malformed variants claim no name; the parser reports them on load
  }
  const held = fs.existsSync(filePath) ? agentNamesOf(filePath) : []
  const claims = (variants.length ? variants.map(v => v.id) : [slug]).filter(name => !held.includes(name))
  if (!claims.length) return

  const agentsDir = path.join(root, ENTITY_DIRS.agent)
  for (const other of walkMarkdown(agentsDir)) {
    if (other === filePath) continue
    const names = agentNamesOf(other)
    const taken = claims.find(name => names.includes(name))
    if (taken) {
      throw new WorkspaceError('ALREADY_EXISTS', `an agent named \`${taken}\` already exists: ${relativePosix(agentsDir, other)}`)
    }
  }
}

function readCurrentRaw(filePath: string): string | null {
  try {
    return fs.readFileSync(filePath, 'utf-8')
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null
    throw err
  }
}

/**
 * Writes where a slug already points — a variant into its declaring file (ADR-0013). The one
 * write path: `expectedRaw` conditions it as `SaveEntityRequest` says; `raw` is the receipt (#158).
 */
export function saveAddressed(
  root: string,
  type: EntityType,
  target: Pick<Address, 'filePath' | 'storageSlug'>,
  data: Record<string, unknown>,
  content: string,
  expectedRaw?: string | null,
) {
  const { filePath, storageSlug } = target
  if (expectedRaw !== undefined && expectedRaw !== null && typeof expectedRaw !== 'string') {
    throw new WorkspaceError('INVALID_CONTENT', 'expectedRaw must be a string or null')
  }
  const text = fileText(data, content)
  if (type === 'agent') assertAgentNamesFree(root, filePath, storageSlug, data.variants)

  // No awaits between resolution, comparison and write: cooperating requests in one engine
  // process cannot interleave. Direct disk writers do not share that guarantee (#158).
  if (expectedRaw !== undefined) {
    const currentRaw = readCurrentRaw(filePath)
    if (currentRaw !== expectedRaw) throw new WorkspaceSaveConflict(storageSlug, currentRaw)
  }
  // A save may be the first write into a type, so it makes the type directory itself.
  fs.mkdirSync(path.join(root, ENTITY_TYPES[type]), { recursive: true })
  try {
    fs.writeFileSync(filePath, text, { encoding: 'utf-8', flag: expectedRaw === null ? 'wx' : 'w' })
  } catch (err) {
    if (expectedRaw === null && (err as NodeJS.ErrnoException).code === 'EEXIST') {
      throw new WorkspaceSaveConflict(storageSlug, readCurrentRaw(filePath))
    }
    throw err
  }
  return { filePath, slug: storageSlug, raw: text }
}

/** Places a file by slug and folder without consulting variants, so a create can never land in a declaring file. */
export function saveWorkspaceEntity(root: string, { type, slug, data, content, folder, expectedRaw }: SaveEntityRequest) {
  const cleanSlug = sanitizeSlug(slug)
  if (!cleanSlug) {
    throw new WorkspaceError('INVALID_NAME', `Invalid name: \`${slug}\``)
  }
  // resolveEntityPath handles sanitization and security checks
  const filePath = resolveEntityPath(root, type, cleanSlug, folder)
  return saveAddressed(root, type, { filePath, storageSlug: cleanSlug }, data, content, expectedRaw)
}

export function createWorkspaceEntity(root: string, { type, name, slug, folder }: CreationParams) {
  const cleanSlug = sanitizeSlug(slug)
  let template: Record<string, unknown>

  switch (type) {
    case 'agent':
      template = { ...getAgentTemplate(name, cleanSlug) }
      break
    case 'skill':
      template = { ...getSkillTemplate(name, cleanSlug) }
      break
    case 'chain':
      template = { ...getChainTemplate(name, cleanSlug) }
      break
    case 'template':
      template = { ...getTemplateTemplate(name, cleanSlug) }
      break
    case 'context':
      template = { content: '' }
      break
    case 'tool':
      template = { ...getToolTemplate(name, cleanSlug) }
      break
    default:
      throw new WorkspaceError('INVALID_NAME', `Unknown entity type: ${type}`)
  }

  const { systemPrompt, content, ...data } = template
  const body = String(systemPrompt || content || '')

  return saveWorkspaceEntity(root, {
    type,
    slug: cleanSlug,
    data,
    content: body,
    folder,
  })
}

// Never writes a marker file into the new directory (#49) — an empty folder is
// local-only on disk until it holds a file, and that's an accepted cost.
export function createWorkspaceFolder(root: string, type: string, folder: string) {
  const folderPath = resolveFolderPath(root, type, folder)
  fs.mkdirSync(folderPath, { recursive: true })
  return { folderPath }
}

// A move only ever changes the path a slug resolves to (ADR-0012): the slug, .versions
// history, and every chain reference by slug are untouched.
export function moveWorkspaceEntity(root: string, type: EntityType, slug: string, folder: string) {
  const found = addressExisting(root, type, slug)
  if (found.kind === 'variant') {
    throw new WorkspaceError('INVALID_NAME', `"${slug}" is a variant declared in ${found.storageSlug}.md — edit that file instead.`)
  }
  const currentPath = found.filePath

  // resolveFolderPath already confines destDir to the type directory, and a
  // basename carries no path separators, so targetPath can't escape it either.
  const destDir = resolveFolderPath(root, type, folder)
  const targetPath = path.join(destDir, path.basename(currentPath))

  if (targetPath === currentPath) {
    return { filePath: targetPath, slug }
  }

  fs.mkdirSync(destDir, { recursive: true })
  fs.renameSync(currentPath, targetPath)
  return { filePath: targetPath, slug }
}

// A folder rename only ever touches its own leaf segment (ADR-0012: a folder is never a
// reference), so it's a plain fs.renameSync with no rewrite pass, unlike an entity rename.
export function renameWorkspaceFolder(root: string, type: EntityType, folder: string, name: string) {
  const cleanName = sanitizeFolder(name)
  if (!cleanName) {
    throw new WorkspaceError('INVALID_NAME', `Invalid name: \`${name}\``)
  }

  const oldPath = resolveFolderPath(root, type, folder)
  if (!fs.existsSync(oldPath)) {
    throw new WorkspaceError('NOT_FOUND', `Folder not found: ${folder}`)
  }

  const slashIndex = folder.lastIndexOf('/')
  const parent = slashIndex === -1 ? '' : folder.slice(0, slashIndex)
  const newFolder = parent ? `${parent}/${cleanName}` : cleanName
  const newPath = resolveFolderPath(root, type, newFolder)

  if (newPath === oldPath) {
    return { folderPath: oldPath, folder }
  }
  if (fs.existsSync(newPath)) {
    throw new WorkspaceError('ALREADY_EXISTS', `a folder named \`${cleanName}\` already exists here`)
  }

  fs.renameSync(oldPath, newPath)
  return { folderPath: newPath, folder: newFolder }
}

// Recursive delete is deliberately not offered (#55): it would destroy files the user
// isn't looking at. Refused with the file count so the user knows what's in the way.
export function deleteWorkspaceFolder(root: string, type: EntityType, folder: string) {
  const folderPath = resolveFolderPath(root, type, folder)
  if (!fs.existsSync(folderPath)) {
    throw new WorkspaceError('NOT_FOUND', `Folder not found: ${folder}`)
  }

  const entries = fs.readdirSync(folderPath).filter(e => !e.startsWith('.'))
  if (entries.length > 0) {
    const fileCount = walkMarkdown(folderPath).length
    const detail = fileCount > 0
      ? `${fileCount} ${fileCount === 1 ? 'file' : 'files'} inside — move or delete them first`
      : `a subfolder is inside — move or delete it first`
    throw new WorkspaceError('FOLDER_NOT_EMPTY', `Folder not empty: ${detail}`)
  }

  fs.rmdirSync(folderPath)
  return { success: true, folderPath }
}
