export function slugify(s: string): string {
  return s.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')
}

export interface ScannedHeading {
  level: number
  heading: string
  headStart: number
  bodyStart: number
  bodyEnd: number
}

// Masks code fences to preserve byte offsets while ignoring inner headings (#129).
function maskCodeBlocks(markdown: string): string {
  return markdown.replace(/```[\s\S]*?(?:```|$)/g, m => m.replace(/[^\r\n]/g, ' '))
}

export function scanHeadings(markdown: string): ScannedHeading[] {
  const masked = maskCodeBlocks(markdown)
  const re = /^(#{1,6})\s+(.+?)\s*$/gm
  const raw: { level: number; heading: string; headStart: number; bodyStart: number }[] = []
  let m: RegExpExecArray | null
  while ((m = re.exec(masked)) !== null) {
    raw.push({
      level: m[1].length,
      heading: m[2].trim(),
      headStart: m.index,
      bodyStart: re.lastIndex,
    })
  }
  return raw.map((h, i) => ({
    level: h.level,
    heading: h.heading,
    headStart: h.headStart,
    bodyStart: h.bodyStart,
    bodyEnd: i + 1 < raw.length ? raw[i + 1].headStart : markdown.length,
  }))
}

export interface MarkdownSection { heading: string; body: string }

// Every heading (any level) with its body, up to the next heading, in order.
export function listSections(markdown: string): MarkdownSection[] {
  return scanHeadings(markdown).map(h => ({
    heading: h.heading,
    body: markdown.slice(h.bodyStart, h.bodyEnd).trim(),
  }))
}

// Returns the slugified text of every markdown heading (#..######), in order.
export function extractSections(markdown: string): string[] {
  return listSections(markdown).map(s => slugify(s.heading)).filter(Boolean)
}

export type SectionPathStatus = 'found' | 'empty' | 'missing' | 'ambiguous'

export interface SectionPathResult {
  text: string
  status: SectionPathStatus
  empty?: boolean
  ambiguousSegment?: string
  missingSegment?: string
}

export function parseSectionPath(path: string): string[] {
  return path.split('/').map(slugify).filter(Boolean)
}

function descendantIndices(headings: ScannedHeading[], parentIndex: number): number[] {
  const parentLevel = headings[parentIndex].level
  const out: number[] = []
  for (let j = parentIndex + 1; j < headings.length; j++) {
    if (headings[j].level <= parentLevel) break
    out.push(j)
  }
  return out
}

// Scans headings along a slash path, resolving duplicates to the first match (#129).
export function extractSectionPath(markdown: string, path: string): SectionPathResult {
  const segments = parseSectionPath(path)
  if (segments.length === 0) return { text: '', status: 'missing' }

  const headings = scanHeadings(markdown)
  if (headings.length === 0) return { text: '', status: 'missing', missingSegment: segments[0] }

  let candidates: number[] = headings.map((_, i) => i)
  let chosenIndex = -1
  let ambiguous = false
  let ambiguousSegment: string | undefined

  for (let s = 0; s < segments.length; s++) {
    const seg = segments[s]
    const matches = candidates.filter(i => slugify(headings[i].heading) === seg)
    if (matches.length === 0) {
      return {
        text: '',
        status: 'missing',
        missingSegment: seg,
        ...(ambiguousSegment ? { ambiguousSegment } : {}),
      }
    }
    if (matches.length > 1) {
      ambiguous = true
      if (!ambiguousSegment) ambiguousSegment = seg
    }
    chosenIndex = matches[0]
    if (s + 1 < segments.length) {
      candidates = descendantIndices(headings, chosenIndex)
    }
  }

  const leaf = headings[chosenIndex]
  const body = markdown.slice(leaf.bodyStart, leaf.bodyEnd).trim()
  const empty = body === ''

  if (ambiguous) {
    return { text: body, status: 'ambiguous', empty, ambiguousSegment }
  }
  if (empty) {
    return { text: '', status: 'empty', empty: true }
  }
  return { text: body, status: 'found', empty: false }
}

export function extractSection(markdown: string, name: string): string {
  return extractSectionPath(markdown, name).text
}

