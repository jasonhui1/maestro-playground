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

// Returns the body of the markdown section whose heading slug-matches `name`,
// from after the heading line to the next heading (any level). '' if not found.
export function extractSection(markdown: string, name: string): string {
  const target = slugify(name)
  const re = /^#{1,6}\s+(.+?)\s*$/gm
  const heads: { slug: string; bodyStart: number; headStart: number }[] = []
  let m: RegExpExecArray | null
  while ((m = re.exec(markdown)) !== null) {
    heads.push({ slug: slugify(m[1]), bodyStart: re.lastIndex, headStart: m.index })
  }
  for (let i = 0; i < heads.length; i++) {
    if (heads[i].slug === target) {
      const end = i + 1 < heads.length ? heads[i + 1].headStart : markdown.length
      return markdown.slice(heads[i].bodyStart, end).trim()
    }
  }
  return ''
}
