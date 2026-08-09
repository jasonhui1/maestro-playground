import matter from 'gray-matter'
import fs from 'fs'
import yaml from 'js-yaml'
import path from 'path'
import { resolveEntityPath, resolveFolderPath, sanitizeSlug, EntityType } from './workspace'
import { validateYaml } from './validate'
import { getAgentTemplate, getSkillTemplate, getChainTemplate, getTemplateTemplate, getToolTemplate } from './templates'
import { CreationParams } from '../types'

export interface SaveEntityRequest {
  type: EntityType
  slug: string
  data: Record<string, any>
  content: string
  folder?: string
}

export function saveWorkspaceEntity({ type, slug, data, content, folder }: SaveEntityRequest) {
  const cleanSlug = sanitizeSlug(slug)

  // Validate frontmatter data if it's provided as a string
  // But here it's an object, so we should stringify it and check if it's valid YAML
  const frontmatterString = yaml.dump(data)
  const validation = validateYaml(frontmatterString)
  if (!validation.valid) {
    throw new Error(`Invalid YAML frontmatter: ${validation.error}`)
  }

  // resolveEntityPath handles sanitization and security checks
  const filePath = resolveEntityPath(type, cleanSlug, folder)
  const fileContent = matter.stringify(content, data)

  fs.writeFileSync(filePath, fileContent, 'utf-8')
  return { filePath, slug: cleanSlug }
}

export function createWorkspaceEntity({ type, name, slug, folder }: CreationParams) {
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
      throw new Error(`Unknown entity type: ${type}`)
  }

  const { systemPrompt, content, ...data } = template
  const body = systemPrompt || content || ''

  return saveWorkspaceEntity({
    type,
    slug: cleanSlug,
    data,
    content: body,
    folder,
  })
}

// Never writes a marker file into the new directory (#49) — an empty folder is
// local-only on disk until it holds a file, and that's an accepted cost.
export function createWorkspaceFolder(type: string, folder: string) {
  const folderPath = resolveFolderPath(type, folder)
  fs.mkdirSync(folderPath, { recursive: true })
  return { folderPath }
}

// A move only ever changes the path a slug resolves to (ADR-0012): the slug, .versions
// history, and every chain reference by slug are untouched.
export function moveWorkspaceEntity(type: EntityType, slug: string, folder: string) {
  const currentPath = resolveEntityPath(type, slug)
  if (!fs.existsSync(currentPath)) {
    throw new Error(`Entity not found: ${type}/${slug}`)
  }

  // resolveFolderPath already confines destDir to the type directory, and a
  // basename carries no path separators, so targetPath can't escape it either.
  const destDir = resolveFolderPath(type, folder)
  const targetPath = path.join(destDir, path.basename(currentPath))

  if (targetPath === currentPath) {
    return { filePath: targetPath, slug }
  }

  fs.mkdirSync(destDir, { recursive: true })
  fs.renameSync(currentPath, targetPath)
  return { filePath: targetPath, slug }
}

export function deleteWorkspaceEntity(type: EntityType, slug: string) {
  const filePath = resolveEntityPath(type, slug)
  if (fs.existsSync(filePath)) {
    fs.unlinkSync(filePath)
    return { success: true, filePath }
  }
  throw new Error(`Entity not found: ${type}/${slug}`)
}
