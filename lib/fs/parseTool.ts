import matter from 'gray-matter'
import fs from 'fs'
import path from 'path'
import { ToolDef, ToolParamDef } from '../types'

const VALID_PARAM_TYPES = new Set(['string', 'number', 'boolean'])

function normalizeParams(raw: unknown, slug: string): Record<string, ToolParamDef> {
  if (raw === undefined || raw === null) return {}
  if (typeof raw !== 'object' || Array.isArray(raw)) {
    throw new Error(`Tool "${slug}": params must be a map of param name to definition`)
  }
  const params: Record<string, ToolParamDef> = {}
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      throw new Error(`Tool "${slug}": param "${key}" must be an object`)
    }
    const v = value as Record<string, unknown>
    if (typeof v.type !== 'string' || !VALID_PARAM_TYPES.has(v.type)) {
      throw new Error(`Tool "${slug}": param "${key}" has invalid type "${String(v.type)}" (expected string, number, or boolean)`)
    }
    params[key] = {
      type: v.type as ToolParamDef['type'],
      ...(typeof v.description === 'string' ? { description: v.description } : {}),
      ...(typeof v.required === 'boolean' ? { required: v.required } : {}),
    }
  }
  return params
}

function normalizeConfig(raw: unknown): Record<string, unknown> {
  return raw && typeof raw === 'object' && !Array.isArray(raw) ? raw as Record<string, unknown> : {}
}

export function parseTool(filePath: string): ToolDef {
  const raw = fs.readFileSync(filePath, 'utf-8')
  const slug = path.basename(filePath, '.md')
  let data: Record<string, unknown>
  let content: string
  try {
    ({ data, content } = matter(raw))
  } catch (err) {
    throw new Error(`Tool "${slug}": failed to parse frontmatter (${err instanceof Error ? err.message : String(err)})`)
  }

  return {
    slug,
    name: typeof data.name === 'string' && data.name ? data.name : slug,
    executor: data.executor as string,
    params: normalizeParams(data.params, slug),
    config: normalizeConfig(data.config),
    activity: typeof data.activity === 'string' ? data.activity : undefined,
    description: content.trim(),
    filePath,
  }
}

export function loadAllTools(workspacePath: string): ToolDef[] {
  const toolsDir = path.join(workspacePath, 'tools')
  if (!fs.existsSync(toolsDir)) return []
  return fs.readdirSync(toolsDir)
    .filter(f => f.endsWith('.md'))
    .map(f => parseTool(path.join(toolsDir, f)))
}
