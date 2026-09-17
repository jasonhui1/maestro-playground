import matter from 'gray-matter'
import fs from 'fs'
import path from 'path'
import { AgentDef, AgentResolution, AGENT_FIELDS, OutputSocketDef, InputSocketDef, VariantDecl } from '../types'
import { discoverFiles, assertUniqueSlug } from './discover'
import { loadAgentDefaults } from './defaults'
import { forbiddenAgentFields } from './validate'
import { resolveProvider } from '../provider'

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

  const envModel = resolveProvider().model
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
    // Read off the same frontmatter as every other field, so a variant block is
    // subject to the same rules rather than a second, laxer parse (ADR-0013).
    variants: normalizeVariants(data.variants, filePath),
    filePath,
    rawContent: raw,
    isFavorite: false,
    resolution,
  }
}

// A malformed entry throws rather than being dropped: a variant is addressable, so
// a silently missing one shows up as an unknown-agent error in a chain instead.
export function normalizeVariants(raw: unknown, where: string): VariantDecl[] {
  if (raw === undefined || raw === null) return []
  if (!Array.isArray(raw)) throw new Error(`${where}: "variants" must be a list.`)
  return raw.map((v, i) => {
    const entry = v as Record<string, unknown>
    const id = typeof entry?.id === 'string' ? entry.id.trim() : ''
    if (!id) throw new Error(`${where}: variant ${i + 1} states no "id".`)
    // One level (ADR-0013): a nested block would otherwise be silently ignored.
    if ('variants' in entry) throw new Error(`${where}: variant "${id}" declares variants; one level only.`)
    const name = typeof entry.name === 'string' ? entry.name.trim() : undefined
    return { ...(entry as unknown as VariantDecl), id, name: name || undefined }
  })
}

function fillSlots(body: string, prompt: VariantDecl['prompt'], where: string): string {
  if (prompt === undefined) return body
  const fills = typeof prompt === 'string' ? { prompt } : prompt
  let out = body
  for (const [slot, value] of Object.entries(fills)) {
    if (value === null || typeof value === 'object') {
      throw new Error(`${where}: prompt slot "${slot}" must be a scalar, not ${Array.isArray(value) ? 'a list' : 'a map'}.`)
    }
    // A slot the body does not declare is a typo the reader would never see: the
    // fill would vanish and the variant would silently be the shared body.
    const token = new RegExp(`\\{\\s*${escapeRegExp(slot)}\\s*\\}`, 'g')
    if (!token.test(out)) {
      throw new Error(`${where}: prompt fills "{${slot}}", which the body does not contain.`)
    }
    token.lastIndex = 0
    // Filling a slot removes its token, so it stops being an input socket: an
    // agent node's sockets are exactly its prompt's slots (ADR-0013).
    out = out.replace(token, String(value))
  }
  return out
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/** One file yields its variants, or itself when it declares none (ADR-0013). */
export function parseAgentFile(
  filePath: string,
  rawContent?: string,
  defaults: Record<string, unknown> = {},
): AgentDef[] {
  const base = parseAgent(filePath, rawContent, defaults)
  if (!base.variants?.length) return [base]

  return base.variants.map(v => {
    const changesSkills = v['skills!'] !== undefined || v['skills+'] !== undefined
    return {
      ...base,
      slug: v.id,
      // A stated name is a display label only, never an address (#61); an unstated
      // one falls back to the id, so a variant still shows something readable.
      name: v.name ?? v.id,
      skills: v['skills!'] ?? [...base.skills, ...(v['skills+'] ?? [])],
      systemPrompt: fillSlots(base.systemPrompt, v.prompt, `${filePath} variant "${v.id}"`),
      variants: undefined,
      variantOf: base.slug,
      resolution: base.resolution
        ? { ...base.resolution, sources: {
            ...base.resolution.sources,
            ...(changesSkills ? { skills: 'variant' as const } : {}),
            ...(v.name ? { name: 'variant' as const } : {}),
          } }
        : base.resolution,
    }
  })
}

export function loadAllAgents(workspacePath: string): AgentDef[] {
  const defaults = loadAgentDefaults(workspacePath)
  const out: AgentDef[] = []
  const bySlug = new Map<string, string>()
  for (const f of discoverFiles(path.join(workspacePath, 'agents'))) {
    for (const a of parseAgentFile(f.filePath, f.raw, defaults)) {
      // A variant name and a file name are addressed alike, so they share the one
      // flat namespace per type (ADR-0012).
      assertUniqueSlug(bySlug, a.slug, a.filePath, 'agent name')
      out.push(a)
    }
  }
  return out
}
