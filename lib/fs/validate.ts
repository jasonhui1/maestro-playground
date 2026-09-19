import yaml from 'js-yaml'

export interface ValidationResult {
  valid: boolean
  error?: string
}

export function validateYaml(raw: string): ValidationResult {
  try {
    yaml.load(raw)
    return { valid: true }
  } catch (err: any) {
    return { valid: false, error: err.message }
  }
}

// Inheritance is one level: workspace/defaults.md is the only parent an agent has,
// and it is never named in the agent file (ADR-0010).
const FORBIDDEN_AGENT_FIELDS = ['parent', 'extends']

export function forbiddenAgentFields(data: Record<string, unknown>): string[] {
  return FORBIDDEN_AGENT_FIELDS.filter(f => f in data)
}

/** The one wording for a rejected inheritance field — the save, the run gate and the drawer share it. */
export function forbiddenAgentFieldMessage(fields: string[]): string {
  return `an agent file may not state ${fields.join(' or ')} — it inherits from workspace/defaults.md only (ADR-0010)`
}

export function validateAgentFrontmatter(data: Record<string, unknown>): ValidationResult {
  const stated = forbiddenAgentFields(data)
  if (stated.length === 0) return { valid: true }
  return { valid: false, error: forbiddenAgentFieldMessage(stated) }
}

export function validateContext(filename: string, content: string): ValidationResult {
  if (!filename || filename.trim() === '') {
    return { valid: false, error: 'Filename is required' }
  }
  if (!content || content.trim() === '') {
    return { valid: false, error: 'Content is required' }
  }
  // Slug-like: alphanumeric, dashes, underscores, and dots
  if (!/^[a-z0-9-_.]+$/i.test(filename)) {
    return { valid: false, error: 'Filename must be slug-like (alphanumeric, dashes, underscores, dots)' }
  }
  return { valid: true }
}

function isNonEmptyString(v: unknown): v is string {
  return typeof v === 'string' && v.trim().length > 0
}

// Frontmatter validation rules per entity type (#122).
export function validateEntityFrontmatter(
  type: string,
  data: Record<string, unknown>,
  defaults?: Record<string, unknown>
): { valid: boolean; errors: string[]; error?: string } {
  const errors: string[] = []
  const d = data || {}

  if (type === 'agent') {
    if (!isNonEmptyString(d.name)) {
      errors.push("Missing required field: 'name'")
    }
    if (!isNonEmptyString(d.model) && !isNonEmptyString(defaults?.model)) {
      errors.push("Missing required field: 'model'")
    }
    const forbidden = forbiddenAgentFields(d)
    if (forbidden.length > 0) {
      errors.push(forbiddenAgentFieldMessage(forbidden))
    }
  } else if (type === 'skill') {
    if (!isNonEmptyString(d.name)) {
      errors.push("Missing required field: 'name'")
    }
  } else if (type === 'chain') {
    if (!isNonEmptyString(d.name)) {
      errors.push("Missing required field: 'name'")
    }
    if (!Array.isArray(d.nodes)) {
      errors.push("Missing or invalid field: 'nodes' (must be an array)")
    }
    if (!Array.isArray(d.edges)) {
      errors.push("Missing or invalid field: 'edges' (must be an array)")
    }
  } else if (type === 'template') {
    if (!isNonEmptyString(d.name)) {
      errors.push("Missing required field: 'name'")
    }
    if (!isNonEmptyString(d.chain)) {
      errors.push("Missing required field: 'chain'")
    }
  } else if (type === 'tool') {
    if (!isNonEmptyString(d.name)) {
      errors.push("Missing required field: 'name'")
    }
    if (!isNonEmptyString(d.executor)) {
      errors.push("Missing required field: 'executor'")
    }
  }

  return {
    valid: errors.length === 0,
    errors,
    ...(errors.length > 0 ? { error: errors[0] } : {}),
  }
}


