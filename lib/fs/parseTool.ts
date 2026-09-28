import matter from 'gray-matter'
import fs from 'fs'
import path from 'path'
import { ToolDef, ToolParamDef, ToolPartDef } from '../types'
import { discoverFiles } from './discover'

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
    if (v.enum !== undefined && (v.type !== 'string' || !Array.isArray(v.enum) || v.enum.length === 0
      || !v.enum.every(e => typeof e === 'string'))) {
      throw new Error(`Tool "${slug}": param "${key}" enum must be a non-empty list of strings on a string param`)
    }
    params[key] = {
      type: v.type as ToolParamDef['type'],
      ...(typeof v.description === 'string' ? { description: v.description } : {}),
      ...(typeof v.required === 'boolean' ? { required: v.required } : {}),
      ...(v.enum ? { enum: v.enum as string[] } : {}),
    }
  }
  return params
}

// `name: text` is a default, `name:` (null) is open, `name: { default?, description? }` is either (#149).
function normalizeParts(raw: unknown, slug: string, params: Record<string, ToolParamDef>): ToolPartDef[] {
  if (raw === undefined || raw === null) return []
  if (typeof raw !== 'object' || Array.isArray(raw)) {
    throw new Error(`Tool "${slug}": parts must be a map of part name to default`)
  }
  return Object.entries(raw as Record<string, unknown>).map(([name, value]) => {
    if (!/^[A-Za-z0-9_-]+$/.test(name)) throw new Error(`Tool "${slug}": part "${name}" may use only letters, digits, "-" and "_"`)
    if (Object.hasOwn(params, name)) throw new Error(`Tool "${slug}": part "${name}" has the same name as a param`)
    if (value === null) return { name }
    if (typeof value === 'string' || typeof value === 'number') return { name, default: String(value) }
    if (typeof value === 'object' && !Array.isArray(value)) {
      const v = value as Record<string, unknown>
      if (v.default !== undefined && v.default !== null && typeof v.default !== 'string') {
        throw new Error(`Tool "${slug}": part "${name}" default must be text`)
      }
      return {
        name,
        ...(typeof v.default === 'string' ? { default: v.default } : {}),
        ...(typeof v.description === 'string' ? { description: v.description } : {}),
      }
    }
    throw new Error(`Tool "${slug}": part "${name}" must be text, empty, or { default, description }`)
  })
}

function normalizeConfig(raw: unknown): Record<string, unknown> {
  return raw && typeof raw === 'object' && !Array.isArray(raw) ? raw as Record<string, unknown> : {}
}

export function parseTool(filePath: string, rawContent?: string): ToolDef {
  const raw = rawContent ?? fs.readFileSync(filePath, 'utf-8')
  const slug = path.basename(filePath, '.md')
  let data: Record<string, unknown>
  let content: string
  try {
    ({ data, content } = matter(raw))
  } catch (err) {
    throw new Error(`Tool "${slug}": failed to parse frontmatter (${err instanceof Error ? err.message : String(err)})`)
  }

  const params = normalizeParams(data.params, slug)
  return {
    slug,
    name: typeof data.name === 'string' && data.name ? data.name : slug,
    executor: data.executor as string,
    params,
    parts: normalizeParts(data.parts, slug, params),
    config: normalizeConfig(data.config),
    activity: typeof data.activity === 'string' ? data.activity : undefined,
    description: content.trim(),
    filePath,
    rawContent: raw,
  }
}

export function loadAllTools(workspacePath: string): ToolDef[] {
  return discoverFiles(path.join(workspacePath, 'tools'))
    .map(f => parseTool(f.filePath, f.raw))
}
