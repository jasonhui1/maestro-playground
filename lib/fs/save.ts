import matter from 'gray-matter'
import fs from 'fs'
import yaml from 'js-yaml'
import { resolveEntityPath, getWorkspacePath, sanitizeSlug } from './workspace'
import { validateYaml } from './validate'
import { getAgentTemplate, getSkillTemplate, getChainTemplate, getTemplateTemplate } from './templates'
import { CreationParams } from '../types'

export interface SaveEntityRequest {
  type: 'agent' | 'skill' | 'chain' | 'template' | 'context'
  slug: string
  data: Record<string, any>
  content: string
}

export function saveWorkspaceEntity({ type, slug, data, content }: SaveEntityRequest) {
  const cleanSlug = sanitizeSlug(slug)

  // Validate frontmatter data if it's provided as a string
  // But here it's an object, so we should stringify it and check if it's valid YAML
  const frontmatterString = yaml.dump(data)
  const validation = validateYaml(frontmatterString)
  if (!validation.valid) {
    throw new Error(`Invalid YAML frontmatter: ${validation.error}`)
  }

  // resolveEntityPath handles sanitization and security checks
  const filePath = resolveEntityPath(type, cleanSlug)
  const fileContent = matter.stringify(content, data)

  fs.writeFileSync(filePath, fileContent, 'utf-8')
  return { filePath, slug: cleanSlug }
}

export function createWorkspaceEntity({ type, name, slug }: CreationParams) {
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
    default:
      throw new Error(`Unknown entity type: ${type}`)
  }

  const { systemPrompt, content, ...data } = template
  const body = systemPrompt || content || ''

  return saveWorkspaceEntity({
    type,
    slug: cleanSlug,
    data,
    content: body
  })
}

export function deleteWorkspaceEntity(type: 'agent' | 'skill' | 'chain' | 'template' | 'context', slug: string) {
  const filePath = resolveEntityPath(type, slug)
  if (fs.existsSync(filePath)) {
    fs.unlinkSync(filePath)
    return { success: true, filePath }
  }
  throw new Error(`Entity not found: ${type}/${slug}`)
}
