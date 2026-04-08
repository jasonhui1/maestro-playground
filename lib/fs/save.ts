import matter from 'gray-matter'
import fs from 'fs'
import yaml from 'js-yaml'
import { resolveEntityPath, getWorkspacePath, sanitizeSlug } from './workspace'
import { validateYaml } from './validate'

export interface SaveEntityRequest {
  type: 'agent' | 'skill' | 'chain' | 'template'
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
