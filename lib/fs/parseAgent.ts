import matter from 'gray-matter'
import fs from 'fs'
import path from 'path'
import { AgentDef } from '../types'

export function parseAgent(filePath: string): AgentDef {
  const raw = fs.readFileSync(filePath, 'utf-8')
  const { data, content } = matter(raw)
  return {
    name: data.name,
    model: process.env.AI_MODEL_NAME || data.model || 'anthropic/claude-3.5-sonnet',
    description: data.description ?? '',
    skills: data.skills ?? [],
    context: data.context ?? [],
    input_from: data.input_from ?? 'user',
    output_format: data.output_format ?? 'markdown',
    systemPrompt: content.trim(),
    filePath,
  }
}

export function loadAllAgents(workspacePath: string): AgentDef[] {
  const agentsDir = path.join(workspacePath, 'agents')
  if (!fs.existsSync(agentsDir)) return []
  return fs.readdirSync(agentsDir)
    .filter(f => f.endsWith('.md'))
    .map(f => parseAgent(path.join(agentsDir, f)))
}
