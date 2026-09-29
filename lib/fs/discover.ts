import fs from 'fs'
import path from 'path'
import { WorkspaceError } from './errors'
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

// Refuses a single write outright, unlike `groupByName`/`discoverFiles` below (#151).
export function assertUniqueSlug(
  bySlug: Map<string, string>,
  slug: string,
  filePath: string,
  what = 'slug',
): void {
  const clash = bySlug.get(slug)
  if (clash) {
    throw new WorkspaceError(
      'ALREADY_EXISTS',
      `Duplicate ${what} "${slug}":\n  ${clash}\n  ${filePath}\n` +
      `Rename one of them — a folder groups files, but the name addresses them.`
    )
  }
  bySlug.set(slug, filePath)
}

/** A repeated name is a clash and both entries are left out of `unique` (#151). */
export function groupByName<T>(
  items: T[],
  nameOf: (item: T) => string,
  pathOf: (item: T) => string,
): { unique: T[]; clashes: NameClash[] } {
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
  return { unique, clashes }
}

// A duplicate slug is left out of `files` and reported in `clashes` instead of
// throwing, so one repeated name doesn't take the rest of the type down (#151).
export function discoverFiles(typeDir: string): DiscoverResult {
  const found = walkMarkdown(typeDir).map(filePath => ({
    slug: path.basename(filePath, '.md'),
    filePath,
    raw: fs.readFileSync(filePath, 'utf-8'),
  }))
  const { unique, clashes } = groupByName(found, f => f.slug, f => f.filePath)
  return { files: unique, clashes }
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
