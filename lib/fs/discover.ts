import fs from 'fs'
import path from 'path'

export interface DiscoveredFile {
  slug: string      // file name without .md; the folder never appears in it (ADR-0012)
  filePath: string
  raw: string       // file bytes as read; ADR-0011 hashes these, not the parsed body
}

/** Every `*.md` under one type directory, at any depth. A duplicate slug throws (ADR-0012). */
export function discoverFiles(typeDir: string): DiscoveredFile[] {
  const found: DiscoveredFile[] = []
  const bySlug = new Map<string, string>()

  for (const filePath of walkMarkdown(typeDir)) {
    const slug = path.basename(filePath, '.md')
    const clash = bySlug.get(slug)
    if (clash) {
      throw new Error(
        `Duplicate slug "${slug}" under ${typeDir}:\n  ${clash}\n  ${filePath}\n` +
        `Rename one of them — a folder groups files, but the name addresses them.`
      )
    }
    bySlug.set(slug, filePath)
    found.push({ slug, filePath, raw: fs.readFileSync(filePath, 'utf-8') })
  }

  return found
}

// Dot-prefixed entries are skipped: `.versions/` holds snapshots of workspace files,
// not workspace files. Carries no slug rule, so it serves path-addressed readers too.
export function walkMarkdown(dir: string): string[] {
  if (!fs.existsSync(dir)) return []
  const out: string[] = []
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name.startsWith('.')) continue
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) out.push(...walkMarkdown(full))
    else if (entry.name.endsWith('.md')) out.push(full)
  }
  return out
}

// Rejects no duplicate, unlike discoverFiles: a workspace that already has one must
// stay editable back into shape (ADR-0012).
export function findBySlug(typeDir: string, slug: string): string | undefined {
  return walkMarkdown(typeDir).find(p => path.basename(p, '.md') === slug)
}

// UI-only: discoverFiles walks *.md and never reports a bare directory, so an empty
// folder is otherwise invisible to the sidebar (ADR-0012's empty-folder gap).
export function walkDirectories(dir: string): string[] {
  if (!fs.existsSync(dir)) return []
  const out: string[] = []
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name.startsWith('.')) continue
    if (entry.isDirectory()) {
      const full = path.join(dir, entry.name)
      out.push(full, ...walkDirectories(full))
    }
  }
  return out
}
