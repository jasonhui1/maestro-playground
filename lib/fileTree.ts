// The sidebar's row list. A folder groups files on disk and never appears in a
// reference (ADR-0012), so the tree is derived here from each file's path.

import { ENTITY_DIRS } from './entityDirs'

export type EntityType = keyof typeof ENTITY_DIRS

export interface TreeItem {
  slug: string
  name: string
  filePath: string
  entityType: EntityType
}

export interface FolderRow {
  kind: 'folder'
  key: string
  /** Folder path relative to the type directory, e.g. `panel/deep`. `__favorites__` for the pinned node. */
  path: string
  label: string
  depth: number
  expanded: boolean
}

export interface FileRow {
  kind: 'file'
  key: string
  label: string
  depth: number
  item: TreeItem
  isFavorite: boolean
  /** The file's folder, shown dim where the row sits outside that folder. */
  subtitle: string | null
}

export type Row = FolderRow | FileRow

// Shares the folder-path namespace: an on-disk folder of this name would share its
// expansion key. Accepted — the pinned node is not addressable on disk.
export const FAVORITES_PATH = '__favorites__'

export interface TreeOptions {
  category: EntityType
  /** Absolute workspace root, from `workspaceRootOf`. Omitted, the type directory is guessed. */
  workspaceRoot?: string
  expanded: Record<string, boolean>
  /** `${entityType}:${slug}` ids, as stored in localStorage. */
  favorites: string[]
  activeSlug?: string | null
  /** Folder paths with no files in them, from the UI-only directory reader (#52). */
  emptyFolders?: string[]
}

function segmentsOf(p: string): string[] {
  return p.replace(/\\/g, '/').split('/').filter(Boolean)
}

/**
 * The workspace root, recovered from the file paths the API sends — the client is
 * never told it directly. Without it a folder named after its own type directory
 * (`agents/agents/`) is indistinguishable from the type directory itself.
 */
export function workspaceRootOf(filePaths: string[]): string | undefined {
  if (filePaths.length === 0) return undefined
  const dirs = filePaths.map(p => segmentsOf(p).slice(0, -1))
  const common = dirs.reduce((acc, d) => {
    const out: string[] = []
    for (let i = 0; i < Math.min(acc.length, d.length) && acc[i] === d[i]; i++) out.push(acc[i])
    return out
  })
  // Two populated types already share exactly the root. One populated type shares a path
  // reaching into it (`<root>/agents/panel`), so everything from its last type-directory
  // segment rightwards comes back off.
  const typeDirs: string[] = Object.values(ENTITY_DIRS)
  const cut = common.map(s => typeDirs.includes(s)).lastIndexOf(true)
  const root = cut === -1 ? common : common.slice(0, cut)
  return root.length > 0 ? `/${root.join('/')}` : undefined
}

/** The path between the type directory and the file: `''` for a file at the type root. */
export function folderOf(filePath: string, category: EntityType, workspaceRoot?: string): string {
  const segments = segmentsOf(filePath)
  const typeDir = ENTITY_DIRS[category]
  const start = workspaceRoot
    ? segmentsOf(workspaceRoot).length
    : segments.lastIndexOf(typeDir)
  if (start === -1 || segments[start] !== typeDir) return ''
  return segments.slice(start + 1, -1).join('/')
}

/** Every folder under the type directory a file could move to — populated or empty, including
 * ancestors of a deep folder, so a move target list never skips an intermediate level. */
export function allFolders(items: TreeItem[], category: EntityType, workspaceRoot: string | undefined, emptyFolders: string[] = []): string[] {
  const set = new Set<string>()
  const add = (folder: string) => { for (const f of ancestorFolders(folder)) set.add(f) }
  for (const item of items) add(folderOf(item.filePath, category, workspaceRoot))
  for (const folder of emptyFolders) add(folder)
  return [...set].sort()
}

/** `panel/deep` → `['panel', 'panel/deep']`. */
export function ancestorFolders(folder: string): string[] {
  if (!folder) return []
  const parts = folder.split('/')
  return parts.map((_, i) => parts.slice(0, i + 1).join('/'))
}

export function folderKey(category: string, folder: string): string {
  return `${category}:${folder}`
}

function byLabel(a: { label: string }, b: { label: string }) {
  return a.label.localeCompare(b.label)
}

export function buildTreeRows(items: TreeItem[], opts: TreeOptions): Row[] {
  const category = opts.category
  const favorites = new Set(opts.favorites)
  const isFav = (i: TreeItem) => favorites.has(`${i.entityType}:${i.slug}`)

  const folderByItem = new Map(items.map(i => [i, folderOf(i.filePath, category, opts.workspaceRoot)]))
  const active = opts.activeSlug ? items.find(i => i.slug === opts.activeSlug) : undefined
  // Auto-expansion only seeds a folder with no stored state, so collapsing an ancestor
  // of the active file by hand still sticks.
  const seededOpen = new Set(active ? ancestorFolders(folderByItem.get(active) ?? '') : [])
  const isExpanded = (folder: string) =>
    opts.expanded[folderKey(category, folder)] ?? seededOpen.has(folder)

  const rows: Row[] = []

  const favItems = items.filter(isFav)
  if (favItems.length > 0) {
    const open = opts.expanded[folderKey(category, FAVORITES_PATH)] ?? true
    rows.push({
      kind: 'folder',
      key: folderKey(category, FAVORITES_PATH),
      path: FAVORITES_PATH,
      label: 'Favorites',
      depth: 0,
      expanded: open,
    })
    if (open) {
      for (const i of favItems.slice().sort((a, b) => a.name.localeCompare(b.name))) {
        rows.push({
          kind: 'file',
          key: `fav:${i.entityType}:${i.slug}`,
          label: i.name,
          depth: 1,
          item: i,
          isFavorite: true,
          subtitle: folderByItem.get(i) || null,
        })
      }
    }
  }

  const knownFolders = [...folderByItem.values(), ...(opts.emptyFolders ?? [])]

  const childFolders = (parent: string) => {
    const prefix = parent ? `${parent}/` : ''
    const names = new Set<string>()
    for (const folder of knownFolders) {
      if (!folder.startsWith(prefix) || folder === parent) continue
      names.add(folder.slice(prefix.length).split('/')[0])
    }
    return [...names].map(label => ({ label, path: prefix + label })).sort(byLabel)
  }

  const emit = (parent: string, depth: number) => {
    for (const folder of childFolders(parent)) {
      const expanded = isExpanded(folder.path)
      rows.push({
        kind: 'folder',
        key: folderKey(category, folder.path),
        path: folder.path,
        label: folder.label,
        depth,
        expanded,
      })
      if (expanded) emit(folder.path, depth + 1)
    }
    const files = items
      .filter(i => folderByItem.get(i) === parent)
      .map(i => ({ item: i, label: i.name }))
      .sort(byLabel)
    for (const { item, label } of files) {
      rows.push({
        kind: 'file',
        key: `${item.entityType}:${item.slug}`,
        label,
        depth,
        item,
        isFavorite: isFav(item),
        subtitle: null,
      })
    }
  }
  emit('', 0)

  return rows
}

/** Search is a second render of the same list: ranking is the point, so the tree flattens. */
export function buildSearchRows(
  ranked: TreeItem[],
  opts: Pick<TreeOptions, 'category' | 'workspaceRoot' | 'favorites'>,
): FileRow[] {
  const favorites = new Set(opts.favorites)
  return ranked.map(item => ({
    kind: 'file',
    key: `${item.entityType}:${item.slug}`,
    label: item.name,
    depth: 0,
    item,
    isFavorite: favorites.has(`${item.entityType}:${item.slug}`),
    subtitle: folderOf(item.filePath, opts.category, opts.workspaceRoot) || null,
  }))
}
