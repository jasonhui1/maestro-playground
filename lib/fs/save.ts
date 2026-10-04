import matter from 'gray-matter'
import fs from 'fs'
import yaml from 'js-yaml'
import path from 'path'
import { resolveAddressedFile, resolveEntityPath, resolveFolderPath, sanitizeSlug, sanitizeFolder, EntityType } from './workspace'
import { WorkspaceError, WorkspaceSaveConflict } from './errors'
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

export function saveWorkspaceEntity(root: string, { type, slug, data, content, folder, expectedRaw }: SaveEntityRequest) {
  const cleanSlug = sanitizeSlug(slug)
  if (expectedRaw !== undefined && expectedRaw !== null && typeof expectedRaw !== 'string') {
    throw new WorkspaceError('INVALID_CONTENT', 'expectedRaw must be a string or null')
  }

  // Validate frontmatter data if it's provided as a string
  // But here it's an object, so we should stringify it and check if it's valid YAML
  const frontmatterString = yaml.dump(data)
  const validation = validateYaml(frontmatterString)
  if (!validation.valid) {
    throw new WorkspaceError('INVALID_CONTENT', `Invalid YAML frontmatter: ${validation.error}`)
  }

  const addressed = resolveAddressedFile(root, type, cleanSlug)
  const storageSlug = addressed.storageSlug
  const filePath = folder === undefined ? addressed.filePath : resolveEntityPath(root, type, storageSlug, folder)

  if (type === 'agent') assertAgentNamesFree(root, filePath, storageSlug, data.variants)

  const fileContent = matter.stringify(content, data)

  // No awaits between resolution, comparison and write: cooperating requests in one engine
  // process cannot interleave. Direct disk writers do not share that guarantee (#158).
  if (expectedRaw !== undefined) {
    const currentRaw = readCurrentRaw(filePath)
    if (currentRaw !== expectedRaw) throw new WorkspaceSaveConflict(storageSlug, currentRaw)
  }
  try {
    fs.writeFileSync(filePath, fileContent, { encoding: 'utf-8', flag: expectedRaw === null ? 'wx' : 'w' })
  } catch (err) {
    if (expectedRaw === null && (err as NodeJS.ErrnoException).code === 'EEXIST') {
      throw new WorkspaceSaveConflict(storageSlug, readCurrentRaw(filePath))
    }
    throw err
  }
  return { filePath, slug: storageSlug, raw: fileContent }
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

  // Creation claims a new file name; it must not edit an existing variant's owner (#158).
  if (type === 'agent') {
    const addressed = resolveAddressedFile(root, type, cleanSlug)
    if (addressed.storageSlug !== cleanSlug) {
      throw new WorkspaceError('ALREADY_EXISTS', `an agent named \`${cleanSlug}\` already exists: ${relativePosix(path.join(root, ENTITY_DIRS.agent), addressed.filePath)}`)
    }
  }

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
  const currentPath = resolveEntityPath(root, type, slug)
  if (!fs.existsSync(currentPath)) {
    throw new WorkspaceError('NOT_FOUND', `Entity not found: ${type}/${slug}`)
  }

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
