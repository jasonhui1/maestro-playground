import fs from 'fs'
import path from 'path'

interface Section {
  heading: string
  body: string
}

interface ScoredSection extends Section {
  folder: string
  file: string
  score: number
}

// Splits markdown into heading-delimited sections, preserving heading text (not slugified —
// this is provenance shown to the model, not a lookup key like lib/graph.ts's extractSections).
function splitSections(markdown: string): Section[] {
  const re = /^#{1,6}\s+(.+?)\s*$/gm
  const heads: { heading: string; bodyStart: number; headStart: number }[] = []
  let m: RegExpExecArray | null
  while ((m = re.exec(markdown)) !== null) {
    heads.push({ heading: m[1], bodyStart: re.lastIndex, headStart: m.index })
  }
  return heads.map((h, i) => ({
    heading: h.heading,
    body: markdown.slice(h.bodyStart, i + 1 < heads.length ? heads[i + 1].headStart : markdown.length).trim(),
  }))
}

function scoreSection(section: Section, terms: string[]): number {
  const text = `${section.heading}\n${section.body}`.toLowerCase()
  return terms.reduce((sum, term) => sum + (text.split(term).length - 1), 0)
}

// Naive lexical retrieve: split workspace .md files under config.folders (default ['context'])
// by heading, score sections by case-insensitive query-term hit count, return the top
// config.maxResults (default 5) as "### folder/file.md › Heading" blocks. Friendly no-match
// message since this is model-facing. config never leaves this function (registry.ts is the
// only caller); only `params` (here, `query`) comes from the model.
export function retrieveExecutor(params: Record<string, unknown>, config: Record<string, unknown>, workspacePath: string): string {
  const query = typeof params.query === 'string' ? params.query.trim() : ''
  const folders = Array.isArray(config.folders) && config.folders.every(f => typeof f === 'string')
    ? config.folders as string[]
    : ['context']
  const maxResults = typeof config.maxResults === 'number' && config.maxResults > 0 ? config.maxResults : 5

  const wsRoot = path.resolve(workspacePath)
  const realWsRoot = fs.existsSync(wsRoot) ? fs.realpathSync(wsRoot) : wsRoot
  const terms = query.toLowerCase().split(/\s+/).filter(Boolean)

  const isInside = (root: string, p: string) => p === root || p.startsWith(root + path.sep)

  const scored: ScoredSection[] = []

  for (const folder of folders) {
    const dir = path.resolve(wsRoot, folder)
    if (!isInside(wsRoot, dir)) {
      throw new Error(`Retrieve: folder "${folder}" resolves outside the workspace`)
    }
    if (!fs.existsSync(dir)) continue
    // Resolve symlinks too — a folder path can pass the string check above yet still be a
    // symlink pointing outside the workspace.
    if (!isInside(realWsRoot, fs.realpathSync(dir))) {
      throw new Error(`Retrieve: folder "${folder}" resolves outside the workspace`)
    }
    for (const file of fs.readdirSync(dir).filter(f => f.endsWith('.md'))) {
      const markdown = fs.readFileSync(path.join(dir, file), 'utf-8')
      for (const section of splitSections(markdown)) {
        const score = terms.length ? scoreSection(section, terms) : 0
        if (score > 0) scored.push({ folder, file, heading: section.heading, body: section.body, score })
      }
    }
  }

  scored.sort((a, b) => b.score - a.score)
  const top = scored.slice(0, maxResults)

  if (top.length === 0) {
    return `No matching sections found for "${query}".`
  }

  return top.map(s => `### ${s.folder}/${s.file} › ${s.heading}\n${s.body}`).join('\n\n')
}
