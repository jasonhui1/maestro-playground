import matter from 'gray-matter'
import fs from 'fs'
import path from 'path'

export const DEFAULTS_FILENAME = 'defaults.md'

// Only the frontmatter is shared. The body of the defaults file is not a prompt —
// the prompt supports extend only, so a default body would have no slot to fill
// and would silence the agent file (ADR-0010).
export function loadAgentDefaults(workspacePath: string): Record<string, unknown> {
  const p = path.join(workspacePath, DEFAULTS_FILENAME)
  if (!fs.existsSync(p)) return {}
  return matter(fs.readFileSync(p, 'utf-8')).data as Record<string, unknown>
}

/** The file bytes a run pins; undefined when the workspace states no defaults (ADR-0011). */
export function readAgentDefaultsRaw(workspacePath: string): string | undefined {
  const p = path.join(workspacePath, DEFAULTS_FILENAME)
  if (!fs.existsSync(p)) return undefined
  return fs.readFileSync(p, 'utf-8')
}
