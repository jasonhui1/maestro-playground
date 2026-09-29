import matter from 'gray-matter'
import fs from 'fs'
import path from 'path'
import { SkillDef, NameClash } from '../types'
import { discoverFiles } from './discover'

export function parseSkill(filePath: string, rawContent?: string): SkillDef {
  const raw = rawContent ?? fs.readFileSync(filePath, 'utf-8')
  const { data, content } = matter(raw)
  const slug = path.basename(filePath, '.md')
  
  return {
    slug,
    name: data.name,
    type: data.type ?? 'behavioural',
    injected: data.injected,
    description: data.description ?? '',
    content: content.trim(),
    filePath,
    rawContent: raw,
    isFavorite: false,
  }
}

export interface LoadAllSkillsResult {
  skills: SkillDef[]
  clashes: NameClash[]
}

export function loadAllSkills(workspacePath: string): LoadAllSkillsResult {
  const { files, clashes } = discoverFiles(path.join(workspacePath, 'skills'))
  return { skills: files.map(f => parseSkill(f.filePath, f.raw)), clashes }
}
