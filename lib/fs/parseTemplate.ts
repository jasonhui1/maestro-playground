import matter from 'gray-matter'
import fs from 'fs'
import path from 'path'
import { TemplateDef } from '../types'
import { loadDiscovered, type Loaded } from './discover'

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

export function loadAllTemplates(workspacePath: string): Loaded<TemplateDef> {
  return loadDiscovered(path.join(workspacePath, 'templates'), f => parseTemplate(f.filePath, f.raw))
}
