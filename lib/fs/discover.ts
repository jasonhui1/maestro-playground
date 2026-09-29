import fs from 'fs'
import path from 'path'
import type { NameClash } from '../types'

export interface DiscoveredFile {
  slug: string      // file name without .md; the folder never appears in it (ADR-0012)
  filePath: string
  raw: string       // file bytes as read; ADR-0011 hashes these, not the parsed body
}

export interface DiscoverResult {
  files: DiscoveredFile[]
  clashes: NameClash[]
}

/** One type's parsed definitions, minus any name discovery left out as a clash. */
export interface Loaded<T> {
  items: T[]
  clashes: NameClash[]
}

/** A repeated name is a clash and every entry claiming it is left out of `items` (#151). */
export function groupByName<T>(
  items: T[],
  nameOf: (item: T) => string,
  pathOf: (item: T) => string,
): Loaded<T> {
  const byName = new Map<string, T[]>()
  for (const item of items) {
    const name = nameOf(item)
    byName.set(name, [...(byName.get(name) ?? []), item])
  }

  const unique: T[] = []
  const clashes: NameClash[] = []
  for (const [name, group] of byName) {
    if (group.length > 1) clashes.push({ name, paths: [...new Set(group.map(pathOf))] })
    else unique.push(group[0])
  }
  return { items: unique, clashes }
}

// A duplicate slug is left out of `files` and reported in `clashes` instead of
// throwing, so one repeated name doesn't take the rest of the type down (#151).
export function discoverFiles(typeDir: string): DiscoverResult {
  const found = walkMarkdown(typeDir).map(filePath => ({
    slug: path.basename(filePath, '.md'),
    filePath,
    raw: fs.readFileSync(filePath, 'utf-8'),
  }))
  const { items, clashes } = groupByName(found, f => f.slug, f => f.filePath)
  return { files: items, clashes }
}

export function loadDiscovered<T>(typeDir: string, parse: (file: DiscoveredFile) => T): Loaded<T> {
  const { files, clashes } = discoverFiles(typeDir)
  return { items: files.map(parse), clashes }
}

/** `filePath` relative to `dir`, with `/` on every platform — the form a message names. */
export function relativePosix(dir: string, filePath: string): string {
  return path.relative(dir, filePath).split(path.sep).join('/')
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

// Takes the first match even for a clashing name, unlike discoverFiles, so a
// workspace that has a clash stays editable back into shape (ADR-0012, #151).
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
