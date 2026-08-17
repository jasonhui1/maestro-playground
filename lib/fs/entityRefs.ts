import matter from 'gray-matter'
import fs from 'fs'
import path from 'path'
import { EntityType, ENTITY_TYPES, getWorkspacePath } from './workspace'
import { walkMarkdown } from './discover'
import { normalizeVariants } from './parseAgent'
import { allFields } from '../nodeKinds'
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

/** A site plus the type it names, which is what selects the sites for one name. */
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

// Passing options opts out of gray-matter's content-keyed cache, which would otherwise
// hand the same object to a later reader — and callers rewrite their parse in place.
export function parseFile(filePath: string) {
  return matter(fs.readFileSync(filePath, 'utf-8'), {})
}

export function typeDir(type: EntityType) {
  return path.join(getWorkspacePath(), ENTITY_TYPES[type])
}

/** One holder file that names a slug, and the typed fields it names it in. */
export interface RefHit {
  filePath: string
  type: EntityType
  fields: string[]
}

/** Reads one typed field. Returns whether it holds `slug`. */
function fieldHolds(holder: Record<string, unknown>, site: RefSite, slug: string): boolean {
  const value = holder[site.field]
  if (site.list) return Array.isArray(value) && value.includes(slug)
  return value === slug
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

/** Walks every site of one holder file, frontmatter and nodes alike, collecting the hits. */
function eachSite(
  data: Record<string, unknown>,
  sites: RefSite[],
  visit: (holder: Record<string, unknown>, site: RefSite) => boolean,
): string[] {
  const touched = new Set<string>()
  for (const site of sites) {
    if (site.scope === 'frontmatter') {
      if (visit(data, site)) touched.add(site.field)
      continue
    }
    const nodes = data.nodes
    if (!Array.isArray(nodes)) continue
    for (const node of nodes) {
      if (node && typeof node === 'object' && visit(node as Record<string, unknown>, site)) {
        touched.add(site.field)
      }
    }
  }
  return Array.from(touched)
}

/** The fields of one parsed holder file that name `slug`. Reads only. */
export function refFieldsIn(data: Record<string, unknown>, sites: RefSite[], slug: string): string[] {
  return eachSite(data, sites, (holder, site) => fieldHolds(holder, site, slug))
}

/** Swaps `from` for `to` at every site of one parsed holder file, in place. */
export function rewriteRefs(
  data: Record<string, unknown>,
  sites: RefSite[],
  from: string,
  to: string,
): string[] {
  return eachSite(data, sites, (holder, site) => rewriteField(holder, site, from, to))
}

/**
 * Every file naming `slug` at a typed site — what a rename rewrites and what a delete is
 * refused for (#63). Prose placeholders are not here: see `refSitesFor`.
 */
export function inboundRefs(type: EntityType, slug: string): RefHit[] {
  const byHolder = new Map<EntityType, RefSite[]>()
  for (const site of refSitesFor(type)) {
    byHolder.set(site.holder, [...(byHolder.get(site.holder) ?? []), site])
  }

  const hits: RefHit[] = []
  for (const [holder, sites] of byHolder) {
    for (const filePath of walkMarkdown(typeDir(holder))) {
      const fields = refFieldsIn(parseFile(filePath).data as Record<string, unknown>, sites, slug)
      if (fields.length) hits.push({ filePath, type: holder, fields })
    }
  }
  return hits
}

/** One variant name, and the file whose frontmatter declares it (ADR-0013). */
export interface VariantSource {
  filePath: string
  fileSlug: string
}

/**
 * Every variant declared under `agents/`, by name — empty for any other type, which has
 * no variants (ADR-0013). Built once per operation and passed down: it reads every agent
 * file, so a workspace of any size pays for it once.
 *
 * A duplicate keeps its first source and a malformed block is skipped: both are load-time
 * errors the workspace already reports (ADR-0012), and neither may block editing an
 * unrelated agent — or editing the broken file back into shape.
 */
export function variantIndex(type: EntityType): Map<string, VariantSource> {
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

/** The variant names one file declares, in file order. Empty for a file declaring none. */
export function declaredVariants(filePath: string): string[] {
  try {
    return normalizeVariants(parseFile(filePath).data.variants, filePath).map(v => v.id)
  } catch {
    return []
  }
}
