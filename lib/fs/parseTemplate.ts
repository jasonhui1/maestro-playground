import matter from 'gray-matter'
import fs from 'fs'
import path from 'path'
import { TemplateDef, NameClash } from '../types'
import { discoverFiles } from './discover'

export function parseTemplate(filePath: string, rawContent?: string): TemplateDef {
  const raw = rawContent ?? fs.readFileSync(filePath, 'utf-8')
  const { data, content } = matter(raw)
  const slug = path.basename(filePath, '.md')
  
  return {
    slug,
    name: data.name,
    description: data.description ?? '',
    chain: data.chain ?? '',
    seedPrompt: content.trim(),
    filePath,
    rawContent: raw,
    isFavorite: false,
  }
}

export interface LoadAllTemplatesResult {
  templates: TemplateDef[]
  clashes: NameClash[]
}

export function loadAllTemplates(workspacePath: string): LoadAllTemplatesResult {
  const { files, clashes } = discoverFiles(path.join(workspacePath, 'templates'))
  return { templates: files.map(f => parseTemplate(f.filePath, f.raw)), clashes }
}
