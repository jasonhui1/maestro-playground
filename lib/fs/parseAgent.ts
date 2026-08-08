import matter from 'gray-matter'
import fs from 'fs'
import path from 'path'
import { AgentDef, AgentResolution, AGENT_FIELDS, OutputSocketDef, InputSocketDef } from '../types'
import { discoverFiles } from './discover'
import { loadAgentDefaults } from './defaults'
import { forbiddenAgentFields } from './validate'

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

export function normalizeInputs(raw: unknown): InputSocketDef[] {
  const list: InputSocketDef[] = []
  const seen = new Set<string>()
  if (Array.isArray(raw)) {
    for (const item of raw) {
      let socket: InputSocketDef | null = null
      if (typeof item === 'string') {
        const name = item.trim()
        if (name) socket = { name }
      } else if (item && typeof item === 'object' && typeof (item as { name?: unknown }).name === 'string') {
        const o = item as { name: string; type?: unknown; description?: unknown; required?: unknown }
        const name = o.name.trim()
        if (name) {
          socket = { name }
          if (typeof o.type === 'string') socket.type = o.type
          if (typeof o.description === 'string') socket.description = o.description
          if (typeof o.required === 'boolean') socket.required = o.required
        }
      }
      if (socket && !seen.has(socket.name)) { seen.add(socket.name); list.push(socket) }
    }
  }
  return list
}

// `model:` with nothing after it parses to null. A reader means "omitted" by that, so
// it must not win the override and shadow the defaults file.
function statedFields<T extends Record<string, unknown>>(data: T): T {
  return Object.fromEntries(Object.entries(data).filter(([, v]) => v !== null && v !== undefined)) as T
}

export function parseAgent(
  filePath: string,
  rawContent?: string,
  // Optional so a def can be parsed on its own; every workspace reader passes the
  // defaults, because the app must see the resolved agent (ADR-0010).
  defaults: Record<string, unknown> = {},
): AgentDef {
  const raw = rawContent ?? fs.readFileSync(filePath, 'utf-8')
  const { data, content } = matter(raw)
  const slug = path.basename(filePath, '.md')

  const stated = statedFields(data)
  const statedDefaults = statedFields(defaults)
  // Override, per field: the agent file value takes the place of the default value.
  // A spread never reaches inside a field, which is what ADR-0010 asks for.
  const merged = { ...statedDefaults, ...stated }

  const envModel = process.env.AI_MODEL_NAME?.trim()
  const resolution: AgentResolution = {
    sources: Object.fromEntries(AGENT_FIELDS.map(f =>
      [f, f in stated ? 'file' : f in statedDefaults ? 'defaults' : 'built-in'],
    )) as AgentResolution['sources'],
    forbidden: forbiddenAgentFields(data),
  }
  if (envModel) resolution.sources.model = 'env'

  return {
    slug,
    name: merged.name,
    // .trim(): a CRLF .env.local leaves a trailing \r on every value. Harmless in
    // headers, fatal here — the model name reaches the JSON body and Google 400s
    // with "unexpected model name format" (#18, and see .env.example).
    model: envModel || merged.model || 'anthropic/claude-3.5-sonnet',
    description: merged.description ?? '',
    skills: merged.skills ?? [],
    context: merged.context ?? [],
    tools: merged.tools ?? [],
    input_from: merged.input_from ?? 'user',
    output_format: merged.output_format ?? 'markdown',
    outputs: normalizeOutputs(merged.outputs),
    inputs: normalizeInputs(merged.inputs),
    max_tokens: merged.max_tokens,
    max_tool_turns: typeof merged.max_tool_turns === 'number' ? merged.max_tool_turns : undefined,
    // The body is never inherited: the prompt supports extend only (ADR-0010).
    systemPrompt: content.trim(),
    filePath,
    rawContent: raw,
    isFavorite: false,
    resolution,
  }
}

export function loadAllAgents(workspacePath: string): AgentDef[] {
  const defaults = loadAgentDefaults(workspacePath)
  return discoverFiles(path.join(workspacePath, 'agents'))
    .map(f => parseAgent(f.filePath, f.raw, defaults))
}
