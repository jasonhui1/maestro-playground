import matter from 'gray-matter'
import fs from 'fs'
import path from 'path'
import { EntityType, ENTITY_TYPES, getWorkspacePath, sanitizeSlug } from './workspace'
import { walkMarkdown, findBySlug } from './discover'
import { normalizeVariants } from './parseAgent'
import { getVersionsDir } from './versions'
import { allFields } from '../nodeKinds'
import { parseVersionKey, versionKey, TouchedFile } from '../runVersions'
import { parseRefs } from '../refs'
import { VariantDecl } from '../types'

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

/** A site plus the type it names, which is what selects the sites for one rename. */
type TypedRefSite = RefSite & { ref: EntityType }

// Node fields derive from the node-kind registry, which owns every field fact (ADR-0001).
const NODE_SITES: TypedRefSite[] = allFields
  .filter(f => f.ref)
  .map(f => ({ holder: 'chain', scope: 'node', field: f.key, list: f.codec === 'stringList', ref: f.ref! }))

// The registry does not reach outside a chain file, so a frontmatter field states itself.
const FRONTMATTER_SITES: TypedRefSite[] = [
  { holder: 'agent', scope: 'frontmatter', field: 'skills', list: true, ref: 'skill' },
  { holder: 'agent', scope: 'frontmatter', field: 'context', list: true, ref: 'context' },
  { holder: 'agent', scope: 'frontmatter', field: 'tools', list: true, ref: 'tool' },
  { holder: 'template', scope: 'frontmatter', field: 'chain', list: false, ref: 'chain' },
]

/**
 * Every typed field that names a file of the given type. Prose `{slug}` placeholders are
 * absent on purpose: they are textual and ambiguous, so a rename reports them instead of
 * rewriting them (#54). This is not a general reference index — #13 owns that.
 */
export function refSitesFor(type: EntityType): RefSite[] {
  return [...NODE_SITES, ...FRONTMATTER_SITES].filter(s => s.ref === type)
}

/**
 * Types whose slug can also appear in prompt prose, as `{slug}` (a context file) or
 * `{slug.field}` (an agent) — see lib/resolver.ts. Nothing else can appear in prose.
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
  /** The renamed file's current path — the declaring file's, for a variant. */
  filePath: string
  /** Set when `from` names a variant (ADR-0013): the slug of the file declaring it. No file moves. */
  variantOf?: string
  rewrites: RenameEdit[]
  /** Run logs whose pinned version key names the old slug, repointed so the run still resolves (ADR-0011). */
  runs: string[]
  /** Files holding a prose `{slug}` placeholder — reported for the user, never rewritten. */
  manual: { filePath: string; type: EntityType }[]
}

// Passing options opts out of gray-matter's content-keyed cache, which would otherwise
// hand the same object to a later reader — and this module rewrites its parse in place.
function parseFile(filePath: string) {
  return matter(fs.readFileSync(filePath, 'utf-8'), {})
}

function typeDir(type: EntityType) {
  return path.join(getWorkspacePath(), ENTITY_TYPES[type])
}

function logsDir() {
  return path.join(getWorkspacePath(), 'logs')
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

/**
 * Applies every site to one holder file's parsed frontmatter, in place, and returns the
 * fields it touched. The planner calls this on a throwaway parse to learn those fields.
 */
function applyRefRewrites(data: Record<string, unknown>, sites: RefSite[], from: string, to: string): string[] {
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
  for (const site of refSitesFor(type)) {
    byHolder.set(site.holder, [...(byHolder.get(site.holder) ?? []), site])
  }

  const edits: RenameEdit[] = []
  for (const [holder, sites] of byHolder) {
    for (const filePath of walkMarkdown(typeDir(holder))) {
      const { data } = parseFile(filePath)
      const fields = applyRefRewrites(data as Record<string, unknown>, sites, from, to)
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
      const { content } = parseFile(filePath)
      if (parseRefs(content).some(ref => ref.kind === kind && ref.target === from)) {
        found.push({ filePath, type: holder })
      }
    }
  }
  return found
}

/** A run never touches a template, so a template rename has no pinned key to repoint (ADR-0011). */
function pinnedType(type: EntityType): TouchedFile['type'] | undefined {
  return type === 'template' ? undefined : type
}

/** Every run whose `meta.json` pins the old `type/slug` key (ADR-0011). */
function collectRuns(type: EntityType, from: string): string[] {
  const pinned = pinnedType(type)
  const dir = logsDir()
  if (!pinned || !fs.existsSync(dir)) return []
  const key = versionKey(pinned, from)
  return fs.readdirSync(dir).filter(runId => {
    const meta = path.join(dir, runId, 'meta.json')
    if (!fs.existsSync(meta)) return false
    try {
      return key in (JSON.parse(fs.readFileSync(meta, 'utf-8')).versions ?? {})
    } catch {
      return false
    }
  })
}

/** One variant name, and the file whose frontmatter declares it (ADR-0013). */
interface VariantSource {
  filePath: string
  fileSlug: string
}

/**
 * Every variant declared under `agents/`, by name — empty for any other type, which has
 * no variants (ADR-0013). Built once per rename and passed down: it reads every agent
 * file, so a workspace of any size pays for it once.
 *
 * A duplicate keeps its first source and a malformed block is skipped: both are load-time
 * errors the workspace already reports (ADR-0012), and neither may block renaming an
 * unrelated agent — or renaming the broken file back into shape.
 */
function variantIndex(type: EntityType): Map<string, VariantSource> {
  const found = new Map<string, VariantSource>()
  if (type !== 'agent') return found
  for (const filePath of walkMarkdown(typeDir('agent'))) {
    let declared: VariantDecl[]
    try {
      declared = normalizeVariants(parseFile(filePath).data.variants, filePath)
    } catch {
      continue
    }
    for (const variant of declared) {
      if (!found.has(variant.id)) found.set(variant.id, { filePath, fileSlug: path.basename(filePath, '.md') })
    }
  }
  return found
}

/** The file a rename acts on: the named file, or the file declaring the named variant. Throws for neither. */
function resolveRenameTarget(
  type: EntityType,
  from: string,
  variants: Map<string, VariantSource>,
): { filePath: string; variantOf?: string } {
  const own = findBySlug(typeDir(type), from)
  if (own) return { filePath: own }
  const variant = variants.get(from)
  if (variant) return { filePath: variant.filePath, variantOf: variant.fileSlug }
  throw new Error(`Entity not found: ${type}/${from}`)
}

/**
 * Refuses a name already claimed under the type — a duplicate leaf name is a hard load
 * failure (ADR-0012), and under `agents/` a file name and a variant name share the one
 * namespace (ADR-0013). The message names the source so the user knows which to look at.
 */
function assertNameFree(type: EntityType, to: string, variants: Map<string, VariantSource>) {
  const file = findBySlug(typeDir(type), to)
  if (file) throw new Error(`a ${type} file named \`${to}\` already exists: ${path.basename(file)}`)
  const variant = variants.get(to)
  if (variant) {
    throw new Error(`an agent variant named \`${to}\` already exists, declared by ${path.basename(variant.filePath)}`)
  }
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

  const variants = variantIndex(type)
  const { filePath, variantOf } = resolveRenameTarget(type, from, variants)

  if (cleanTo === from) {
    return { type, from, to: cleanTo, filePath, variantOf, rewrites: [], runs: [], manual: [] }
  }

  assertNameFree(type, cleanTo, variants)

  // A file that declares variants yields its variants and nothing else, so its own name
  // addresses no chain and moving it rewrites nothing (ADR-0013).
  const addressable = variantOf !== undefined || ![...variants.values()].some(v => v.filePath === filePath)
  const ownEdit: RenameEdit[] = variantOf ? [{ filePath, type: 'agent', fields: ['variants'] }] : []

  return {
    type,
    from,
    to: cleanTo,
    filePath,
    variantOf,
    rewrites: addressable ? [...ownEdit, ...collectRewrites(type, from, cleanTo)] : [],
    // A run keys on the declaring file's slug (ADR-0011), which a variant rename never
    // changes, so there is no pinned key to repoint.
    runs: variantOf ? [] : collectRuns(type, from),
    manual: collectManual(type, from),
  }
}

/**
 * Renames a file, its `.versions` history, every typed reference to it, and the pinned
 * key each past run recorded (#54). The file keeps its folder — only the slug changes,
 * and the slug is the reference. A failure part-way restores every file already written,
 * so the workspace never loads with half a rename applied.
 */
export function renameWorkspaceEntity(type: EntityType, from: string, to: string) {
  const plan = planRename(type, from, to)
  if (plan.to === from) return { filePath: plan.filePath, slug: from, plan }

  const written = new Map<string, string>()
  const write = (filePath: string, body: string) => {
    if (!written.has(filePath)) written.set(filePath, fs.readFileSync(filePath, 'utf-8'))
    fs.writeFileSync(filePath, body, 'utf-8')
  }

  const targetPath = path.join(path.dirname(plan.filePath), `${plan.to}.md`)
  let moved = false
  try {
    const sites = refSitesFor(type)
    for (const edit of plan.rewrites) {
      // The declaring file is in the list so the preview names it, but its `variants`
      // block is not a typed reference site — it is rewritten below.
      if (plan.variantOf && edit.filePath === plan.filePath) continue
      const { data, content } = parseFile(edit.filePath)
      applyRefRewrites(data as Record<string, unknown>, sites.filter(s => s.holder === edit.type), from, plan.to)
      write(edit.filePath, matter.stringify(content, data))
    }
    for (const runId of plan.runs) repointRun(runId, type, from, plan.to, write)

    if (plan.variantOf) {
      renameVariantId(plan.filePath, from, plan.to, write)
    } else {
      renameOwnName(plan.filePath, type, from, plan.to, write)
      fs.renameSync(plan.filePath, targetPath)
      moved = true
      renameVersions(type, from, plan.to)
    }
  } catch (err) {
    // The file moves back first: restoring bytes to the old path while the new path
    // still holds the file would leave two files sharing a slug (ADR-0012). `moved`
    // rather than existsSync — whatever else may sit at that path is not our file.
    if (moved) fs.renameSync(targetPath, plan.filePath)
    for (const [filePath, body] of written) fs.writeFileSync(filePath, body, 'utf-8')
    throw err
  }

  return { filePath: plan.variantOf ? plan.filePath : targetPath, slug: plan.to, plan }
}

/**
 * A variant's name is its `id` in the declaring file's frontmatter (ADR-0013), so the
 * rename edits that entry in place. A stated `name:` is a display label, never an
 * address, so it is left alone (#61).
 */
function renameVariantId(
  filePath: string,
  from: string,
  to: string,
  write: (filePath: string, body: string) => void,
) {
  const { data, content } = parseFile(filePath)
  const variants = Array.isArray(data.variants) ? data.variants : []
  const entry = variants.find(v => v && typeof v === 'object' && (v as { id?: unknown }).id === from)
  if (!entry) throw new Error(`Entity not found: agent/${from}`)
  ;(entry as { id: string }).id = to
  write(filePath, matter.stringify(content, data))
}

/**
 * A pinned key is `type/slug` (ADR-0011), so it holds the old address once the slug moves.
 * Only the key changes — the version number, and everything else the run recorded, stands.
 */
function repointRun(
  runId: string,
  type: EntityType,
  from: string,
  to: string,
  write: (filePath: string, body: string) => void,
) {
  const pinned = pinnedType(type)
  if (!pinned) return
  const metaPath = path.join(logsDir(), runId, 'meta.json')
  const meta = JSON.parse(fs.readFileSync(metaPath, 'utf-8'))
  meta.versions = Object.fromEntries(
    Object.entries(meta.versions as Record<string, number>).map(([key, version]) => {
      const parsed = parseVersionKey(key)
      return parsed.type === pinned && parsed.slug === from ? [versionKey(pinned, to), version] : [key, version]
    }),
  )
  write(metaPath, JSON.stringify(meta, null, 2))
}

/**
 * A skill and a tool are both matched at run time by frontmatter `name`, not slug
 * (lib/prompt.ts, lib/tools/registry.ts), so the name follows the slug. A name the user
 * has set apart from the slug is left alone.
 */
function renameOwnName(
  filePath: string,
  type: EntityType,
  from: string,
  to: string,
  write: (filePath: string, body: string) => void,
) {
  if (type !== 'skill' && type !== 'tool') return
  const { data, content } = parseFile(filePath)
  if (data.name !== from) return
  data.name = to
  write(filePath, matter.stringify(content, data))
}

/** Snapshots are keyed by slug (ADR-0011), so the history directory follows the rename. */
function renameVersions(type: EntityType, from: string, to: string) {
  const oldDir = getVersionsDir(type, from)
  if (!fs.existsSync(oldDir)) return
  fs.renameSync(oldDir, getVersionsDir(type, to))
}
