import { RunMeta, AgentDef } from './types'
import { parseRefs, ParsedRef } from './refs'

export function slugify(s: string): string {
  return s.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')
}

// Returns the slugified text of every markdown heading (#..######), in order.
export function extractSections(markdown: string): string[] {
  const re = /^#{1,6}\s+(.+?)\s*$/gm
  const out: string[] = []
  let m: RegExpExecArray | null
  while ((m = re.exec(markdown)) !== null) {
    const slug = slugify(m[1])
    if (slug) out.push(slug)
  }
  return out
}
