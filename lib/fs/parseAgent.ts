import matter from 'gray-matter'
import fs from 'fs'
import path from 'path'
import { AgentDef, OutputSocketDef } from '../types'

// Normalizes the hybrid `outputs:` frontmatter (array of strings and/or
// { name, type?, description? } objects) into OutputSocketDef[]
// The implicit `output` socket is always first; `summary` only if declared.
export function normalizeOutputs(raw: unknown): OutputSocketDef[] {
  const list: OutputSocketDef[] = [{ name: 'output' }]
  const seen = new Set<string>(['output'])
  if (Array.isArray(raw)) {
    for (const item of raw) {
      let socket: OutputSocketDef | null = null
      if (typeof item === 'string') {
        const name = item.trim()
        if (name) socket = { name }
      } else if (item && typeof item === 'object' && typeof (item as { name?: unknown }).name === 'string') {
        const o = item as { name: string; type?: unknown; description?: unknown }
        const name = o.name.trim()
        if (name) {
          socket = { name }
          if (typeof o.type === 'string') socket.type = o.type
          if (typeof o.description === 'string') socket.description = o.description
        }
      }
      if (socket && !seen.has(socket.name)) {
        seen.add(socket.name)
        list.push(socket)
      }
    }
  }
  return list
}

export function parseAgent(filePath: string): AgentDef {
  const raw = fs.readFileSync(filePath, 'utf-8')
  const { data, content } = matter(raw)
  const slug = path.basename(filePath, '.md')
  
  return {
    slug,
    name: data.name,
    model: process.env.AI_MODEL_NAME || data.model || 'anthropic/claude-3.5-sonnet',
    description: data.description ?? '',
    skills: data.skills ?? [],
    context: data.context ?? [],
    input_from: data.input_from ?? 'user',
    output_format: data.output_format ?? 'markdown',
    outputs: normalizeOutputs(data.outputs),
    max_tokens: data.max_tokens,
    systemPrompt: content.trim(),
    filePath,
    isFavorite: false,
  }
}

export function loadAllAgents(workspacePath: string): AgentDef[] {
  const agentsDir = path.join(workspacePath, 'agents')
  if (!fs.existsSync(agentsDir)) return []
  return fs.readdirSync(agentsDir)
    .filter(f => f.endsWith('.md'))
    .map(f => parseAgent(path.join(agentsDir, f)))
}
