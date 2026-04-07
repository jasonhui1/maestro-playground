import matter from 'gray-matter'
import fs from 'fs'
import path from 'path'
import { TemplateDef } from '../types'

export function parseTemplate(filePath: string): TemplateDef {
  const raw = fs.readFileSync(filePath, 'utf-8')
  const { data, content } = matter(raw)
  return {
    name: data.name,
    description: data.description ?? '',
    chain: data.chain ?? '',
    seedPrompt: content.trim(),
    filePath,
  }
}

export function loadAllTemplates(workspacePath: string): TemplateDef[] {
  const templatesDir = path.join(workspacePath, 'templates')
  if (!fs.existsSync(templatesDir)) return []
  return fs.readdirSync(templatesDir)
    .filter(f => f.endsWith('.md'))
    .map(f => parseTemplate(path.join(templatesDir, f)))
}
