import matter from 'gray-matter'
import fs from 'fs'
import path from 'path'
import { SkillDef } from '../types'

export function parseSkill(filePath: string): SkillDef {
  const raw = fs.readFileSync(filePath, 'utf-8')
  const { data, content } = matter(raw)
  return {
    name: data.name,
    type: data.type ?? 'behavioural',
    injected: data.injected,
    description: data.description ?? '',
    content: content.trim(),
    filePath,
  }
}

export function loadAllSkills(workspacePath: string): SkillDef[] {
  const skillsDir = path.join(workspacePath, 'skills')
  if (!fs.existsSync(skillsDir)) return []
  return fs.readdirSync(skillsDir)
    .filter(f => f.endsWith('.md'))
    .map(f => parseSkill(path.join(skillsDir, f)))
}
