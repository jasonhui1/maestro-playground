// The sidebar's row list. A folder groups files on disk and never appears in a
// reference (ADR-0012), so the tree is derived here from each file's path.

import { ENTITY_DIRS } from './entityDirs'

export type EntityType = keyof typeof ENTITY_DIRS

export interface TreeItem {
  slug: string
  name: string
  filePath: string
  entityType: EntityType
  /** Set only for an agent variant (ADR-0013): the slug of the file that declares it. */
  variantOf?: string
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
  /** Row sits under the pinned ★ Favorites node, not its real folder — not a drag source (#56). */
  inFavorites: boolean
}

/** A variant has no file of its own (ADR-0013) — it renders as a child row of the file
 * that declares it, never as a sibling. Its own row carries no file actions. */
export interface VariantRow {
  kind: 'variant'
  key: string
  label: string
  depth: number
  item: TreeItem
  /** The declaring file — selecting a variant opens this file. */
  fileItem: TreeItem
}

export type Row = FolderRow | FileRow | VariantRow

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

// Distinct from any folder row's key (`${category}:${path}`), so it never collides (#56).
export const ROOT_DROP_ID = '__root_drop__'

/** Maps a dnd-kit drop target to the folder `onMove` expects, or undefined for an invalid drop (#56). */
export function resolveDropFolder(overId: string, overFolderPath: string | undefined): string | undefined {
  if (overId === ROOT_DROP_ID) return ''
  return overFolderPath
}

function byLabel(a: { label: string }, b: { label: string }) {
  return a.label.localeCompare(b.label)
}

export function buildTreeRows(items: TreeItem[], opts: TreeOptions): Row[] {
  const category = opts.category
  const favorites = new Set(opts.favorites)
  const isFav = (i: TreeItem) => favorites.has(`${i.entityType}:${i.slug}`)

  // A variant is not a file on disk (ADR-0013) — only the declaring file draws a row;
  // its variants render as that row's children (#60).
  const fileItems = items.filter(i => !i.variantOf)
  const variantsByFile = new Map<string, TreeItem[]>()
  for (const i of items) {
    if (!i.variantOf) continue
    const list = variantsByFile.get(i.variantOf) ?? []
    list.push(i)
    variantsByFile.set(i.variantOf, list)
  }
  const variantRowsFor = (file: TreeItem, depth: number): VariantRow[] =>
    (variantsByFile.get(file.slug) ?? [])
      .slice()
      .sort((a, b) => a.name.localeCompare(b.name))
      .map(v => ({
        kind: 'variant',
        key: `variant:${v.entityType}:${v.slug}`,
        label: v.name,
        depth,
        item: v,
        fileItem: file,
      }))

  const folderByItem = new Map(fileItems.map(i => [i, folderOf(i.filePath, category, opts.workspaceRoot)]))
  const active = opts.activeSlug ? fileItems.find(i => i.slug === opts.activeSlug) : undefined
  // Auto-expansion only seeds a folder with no stored state, so collapsing an ancestor
  // of the active file by hand still sticks.
  const seededOpen = new Set(active ? ancestorFolders(folderByItem.get(active) ?? '') : [])
  const isExpanded = (folder: string) =>
    opts.expanded[folderKey(category, folder)] ?? seededOpen.has(folder)

  const rows: Row[] = []

  const favItems = fileItems.filter(isFav)
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
          inFavorites: true,
        })
        rows.push(...variantRowsFor(i, 2))
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
    const files = fileItems
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
        inFavorites: false,
      })
      rows.push(...variantRowsFor(item, depth + 1))
    }
  }
  emit('', 0)

  return rows
}

/** Search is a second render of the same list: ranking is the point, so the tree flattens —
 * except a matched variant, which still reveals nested under its declaring file (#60), found
 * via `allItems` since a match on the variant alone doesn't rank its file. */
export function buildSearchRows(
  ranked: TreeItem[],
  allItems: TreeItem[],
  opts: Pick<TreeOptions, 'category' | 'workspaceRoot' | 'favorites'>,
): (FileRow | VariantRow)[] {
  const favorites = new Set(opts.favorites)
  const rows: (FileRow | VariantRow)[] = []
  const emittedFiles = new Set<string>()

  const pushFile = (item: TreeItem) => {
    if (emittedFiles.has(item.slug)) return
    emittedFiles.add(item.slug)
    rows.push({
      kind: 'file',
      key: `${item.entityType}:${item.slug}`,
      label: item.name,
      depth: 0,
      item,
      isFavorite: favorites.has(`${item.entityType}:${item.slug}`),
      subtitle: folderOf(item.filePath, opts.category, opts.workspaceRoot) || null,
      inFavorites: false,
    })
  }

  for (const matched of ranked) {
    if (!matched.variantOf) {
      pushFile(matched)
      continue
    }
    const file = allItems.find(i => i.slug === matched.variantOf && !i.variantOf)
    if (!file) continue
    pushFile(file)
    rows.push({
      kind: 'variant',
      key: `variant:${matched.entityType}:${matched.slug}`,
      label: matched.name,
      depth: 1,
      item: matched,
      fileItem: file,
    })
  }
  return rows
}
