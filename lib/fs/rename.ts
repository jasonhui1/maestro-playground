import matter from 'gray-matter'
import fs from 'fs'
import path from 'path'
import { EntityType, ENTITY_TYPES, getWorkspacePath, sanitizeSlug } from './workspace'
import { walkMarkdown, findBySlug } from './discover'
import { getVersionsDir } from './versions'
import { parseRefs } from '../refs'

/**
 * A typed field that holds a slug — the parser knows a slug sits there and nowhere else.
 * `scope: 'node'` means the field sits on each entry of a chain file's `nodes` list.
 */
export interface RefSite {
  holder: EntityType
  scope: 'frontmatter' | 'node'
  field: string
  list: boolean
}

/**
 * Where a slug of each type is named by a typed field. Prose `{slug}` placeholders are
 * absent on purpose: they are textual and ambiguous, so a rename reports them instead
 * of rewriting them (#54). This is not a general reference index — #13 owns that.
 */
export const REF_SITES: Record<EntityType, RefSite[]> = {
  agent: [{ holder: 'chain', scope: 'node', field: 'agent', list: false }],
  skill: [
    { holder: 'agent', scope: 'frontmatter', field: 'skills', list: true },
    { holder: 'chain', scope: 'node', field: 'skills!', list: true },
    { holder: 'chain', scope: 'node', field: 'skills+', list: true },
  ],
  chain: [
    { holder: 'chain', scope: 'node', field: 'subchain', list: false },
    { holder: 'template', scope: 'frontmatter', field: 'chain', list: false },
  ],
  context: [
    { holder: 'agent', scope: 'frontmatter', field: 'context', list: true },
    { holder: 'chain', scope: 'node', field: 'file', list: false },
  ],
  // No typed field names a template; a template names a chain, not the reverse.
  template: [],
}

/**
 * Types whose slug can also appear in prompt prose, as `{slug}` (a context file) or
 * `{slug.field}` (an agent) — see lib/resolver.ts. Renaming one of these scans bodies
 * so the dialog can report them; nothing else can appear in prose.
 */
const PROSE_REF_KIND: Partial<Record<EntityType, 'file' | 'agent'>> = {
  context: 'file',
  agent: 'agent',
}

/** One referencing file the rename will rewrite, and the typed fields it will touch. */
export interface RenameEdit {
  filePath: string
  type: EntityType
  fields: string[]
}

export interface RenamePlan {
  type: EntityType
  from: string
  to: string
  /** The renamed file's current path. */
  filePath: string
  rewrites: RenameEdit[]
  /** Files holding a prose `{slug}` placeholder — reported for the user, never rewritten. */
  manual: { filePath: string; type: EntityType }[]
}

function typeDir(type: EntityType) {
  return path.join(getWorkspacePath(), ENTITY_TYPES[type])
}

/** Swaps `from` for `to` in one typed field, in place. Returns whether it changed. */
function rewriteField(holder: Record<string, unknown>, site: RefSite, from: string, to: string): boolean {
  const value = holder[site.field]
  if (site.list) {
    if (!Array.isArray(value)) return false
    let changed = false
    holder[site.field] = value.map(entry => {
      if (entry === from) { changed = true; return to }
      return entry
    })
    return changed
  }
  if (value !== from) return false
  holder[site.field] = to
  return true
}

/** Applies every site for one holder file to its parsed frontmatter. Returns the fields touched. */
function rewriteData(data: Record<string, unknown>, sites: RefSite[], from: string, to: string): string[] {
  const touched = new Set<string>()
  for (const site of sites) {
    if (site.scope === 'frontmatter') {
      if (rewriteField(data, site, from, to)) touched.add(site.field)
      continue
    }
    const nodes = data.nodes
    if (!Array.isArray(nodes)) continue
    for (const node of nodes) {
      if (node && typeof node === 'object' && rewriteField(node as Record<string, unknown>, site, from, to)) {
        touched.add(site.field)
      }
    }
  }
  return Array.from(touched)
}

function collectRewrites(type: EntityType, from: string, to: string): RenameEdit[] {
  const byHolder = new Map<EntityType, RefSite[]>()
  for (const site of REF_SITES[type]) {
    byHolder.set(site.holder, [...(byHolder.get(site.holder) ?? []), site])
  }

  const edits: RenameEdit[] = []
  for (const [holder, sites] of byHolder) {
    for (const filePath of walkMarkdown(typeDir(holder))) {
      const { data } = matter(fs.readFileSync(filePath, 'utf-8'))
      const fields = rewriteData(data as Record<string, unknown>, sites, from, to)
      if (fields.length) edits.push({ filePath, type: holder, fields })
    }
  }
  return edits
}

function collectManual(type: EntityType, from: string): { filePath: string; type: EntityType }[] {
  const kind = PROSE_REF_KIND[type]
  if (!kind) return []

  const found: { filePath: string; type: EntityType }[] = []
  for (const holder of Object.keys(ENTITY_TYPES) as EntityType[]) {
    for (const filePath of walkMarkdown(typeDir(holder))) {
      const { content } = matter(fs.readFileSync(filePath, 'utf-8'))
      const names = parseRefs(content).some(ref => ref.kind === kind && ref.target === from)
      if (names) found.push({ filePath, type: holder })
    }
  }
  return found
}

/**
 * What a rename would do, without touching disk. Throws for a name that cannot be taken —
 * the dialog shows that inline rather than as a plan.
 */
export function planRename(type: EntityType, from: string, to: string): RenamePlan {
  const cleanTo = sanitizeSlug(to)
  if (!cleanTo || cleanTo === '.' || cleanTo === '..') {
    throw new Error(`Invalid name: \`${to}\``)
  }

  const dir = typeDir(type)
  const filePath = findBySlug(dir, from)
  if (!filePath) throw new Error(`Entity not found: ${type}/${from}`)

  if (cleanTo === from) {
    return { type, from, to: cleanTo, filePath, rewrites: [], manual: [] }
  }

  // A duplicate leaf name anywhere under the type is a hard load failure (ADR-0012),
  // so the rename is refused before it can create one.
  if (findBySlug(dir, cleanTo)) {
    throw new Error(`a ${type} named \`${cleanTo}\` already exists`)
  }

  return {
    type,
    from,
    to: cleanTo,
    filePath,
    rewrites: collectRewrites(type, from, cleanTo),
    manual: collectManual(type, from),
  }
}

/**
 * Renames a file, its `.versions` history, and every typed reference to it (#54).
 * The file keeps its folder — only the slug changes, and the slug is the reference.
 */
export function renameWorkspaceEntity(type: EntityType, from: string, to: string) {
  const plan = planRename(type, from, to)
  if (plan.to === from) return { filePath: plan.filePath, slug: from, plan }

  for (const edit of plan.rewrites) {
    const { data, content } = matter(fs.readFileSync(edit.filePath, 'utf-8'))
    rewriteData(data as Record<string, unknown>, REF_SITES[type].filter(s => s.holder === edit.type), from, plan.to)
    fs.writeFileSync(edit.filePath, matter.stringify(content, data), 'utf-8')
  }

  const targetPath = path.join(path.dirname(plan.filePath), `${plan.to}.md`)
  renameOwnName(plan.filePath, type, from, plan.to)
  fs.renameSync(plan.filePath, targetPath)
  renameVersions(type, from, plan.to)

  return { filePath: targetPath, slug: plan.to, plan }
}

/**
 * A skill is matched at run time by its frontmatter `name`, not its slug (lib/prompt.ts),
 * so the name follows the slug — otherwise the rewritten `skills:` lists match nothing.
 * A name the user has set apart from the slug is left alone.
 */
function renameOwnName(filePath: string, type: EntityType, from: string, to: string) {
  if (type !== 'skill') return
  const { data, content } = matter(fs.readFileSync(filePath, 'utf-8'))
  if (data.name !== from) return
  data.name = to
  fs.writeFileSync(filePath, matter.stringify(content, data), 'utf-8')
}

/** Snapshots are keyed by slug (ADR-0011), so the history directory follows the rename. */
function renameVersions(type: EntityType, from: string, to: string) {
  const oldDir = getVersionsDir(type, from)
  if (!fs.existsSync(oldDir)) return
  fs.renameSync(oldDir, getVersionsDir(type, to))
}
