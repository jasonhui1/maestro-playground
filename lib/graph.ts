export function slugify(s: string): string {
  return s.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')
}

// Returns the slugified text of every markdown heading (#..######), in order.
export function extractSections(markdown: string): string[] {
  // Strip code blocks to avoid extracting headers within block code / examples
  const cleaned = markdown.replace(/```[\s\S]*?```/g, '')
  const re = /^#{1,6}\s+(.+?)\s*$/gm
  const out: string[] = []
  let m: RegExpExecArray | null
  while ((m = re.exec(cleaned)) !== null) {
    const slug = slugify(m[1])
    if (slug) out.push(slug)
  }
  return out
}

export interface MarkdownSection { heading: string; body: string }

// Every heading (any level) with its body, up to the next heading, in order.
export function listSections(markdown: string): MarkdownSection[] {
  const re = /^#{1,6}\s+(.+?)\s*$/gm
  const heads: { heading: string; bodyStart: number; headStart: number }[] = []
  let m: RegExpExecArray | null
  while ((m = re.exec(markdown)) !== null) {
    heads.push({ heading: m[1], bodyStart: re.lastIndex, headStart: m.index })
  }
  return heads.map((h, i) => {
    const end = i + 1 < heads.length ? heads[i + 1].headStart : markdown.length
    return { heading: h.heading, body: markdown.slice(h.bodyStart, end).trim() }
  })
}

// Returns the body of the markdown section whose heading slug-matches `name`,
// from after the heading line to the next heading (any level). '' if not found.
export function extractSection(markdown: string, name: string): string {
  const target = slugify(name)
  return listSections(markdown).find(s => slugify(s.heading) === target)?.body ?? ''
}
