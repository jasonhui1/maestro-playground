import matter from 'gray-matter'
import fs from 'fs'
import yaml from 'js-yaml'
import path from 'path'
import { resolveEntityPath, resolveFolderPath, sanitizeSlug, sanitizeFolder, EntityType } from './workspace'
import { WorkspaceError } from './errors'
import { validateYaml } from './validate'
import { getAgentTemplate, getSkillTemplate, getChainTemplate, getTemplateTemplate, getToolTemplate } from './templates'
import { CreationParams } from '../types'
import { walkMarkdown } from './discover'

export interface SaveEntityRequest {
  type: EntityType
  slug: string
  data: Record<string, any>
  content: string
  folder?: string
}

export function saveWorkspaceEntity(root: string, { type, slug, data, content, folder }: SaveEntityRequest) {
  const cleanSlug = sanitizeSlug(slug)

  // Validate frontmatter data if it's provided as a string
  // But here it's an object, so we should stringify it and check if it's valid YAML
  const frontmatterString = yaml.dump(data)
  const validation = validateYaml(frontmatterString)
  if (!validation.valid) {
    throw new WorkspaceError('INVALID_CONTENT', `Invalid YAML frontmatter: ${validation.error}`)
  }

  // resolveEntityPath handles sanitization and security checks
  const filePath = resolveEntityPath(root, type, cleanSlug, folder)
  const fileContent = matter.stringify(content, data)

  fs.writeFileSync(filePath, fileContent, 'utf-8')
  return { filePath, slug: cleanSlug }
}

export function createWorkspaceEntity(root: string, { type, name, slug, folder }: CreationParams) {
  const cleanSlug = sanitizeSlug(slug)
  let template: any

  switch (type) {
    case 'agent':
      template = getAgentTemplate(name, cleanSlug)
      break
    case 'skill':
      template = getSkillTemplate(name, cleanSlug)
      break
    case 'chain':
      template = getChainTemplate(name, cleanSlug)
      break
    case 'template':
      template = getTemplateTemplate(name, cleanSlug)
      break
    case 'context':
      template = { content: '' }
      break
    case 'tool':
      template = getToolTemplate(name, cleanSlug)
      break
    default:
      throw new WorkspaceError('INVALID_NAME', `Unknown entity type: ${type}`)
  }

  const { systemPrompt, content, ...data } = template
  const body = systemPrompt || content || ''

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
