import path from 'path'
import { findBySlug } from './discover'
import { variantIndex, type VariantSource } from './variantIndex'
import { WorkspaceError } from './errors'
import { ENTITY_TYPES, isValidEntityType, resolveEntityPath, sanitizeSlug, type EntityType } from './workspace'

/**
 * What a slug answers to under a type. `file`: a file of that name. `variant`: a variant
 * declared inside another file; reachable only for agents (ADR-0013). `new`: nothing
 * answers to it, and `filePath` is where a save would put it.
 */
export type Address =
  | { kind: 'file'; filePath: string; storageSlug: string }
  | { kind: 'variant'; filePath: string; storageSlug: string; variantOf: string }
  | { kind: 'new'; filePath: string; storageSlug: string }

/**
 * The one place a slug becomes a file (ADR-0012, ADR-0013, #164): a file of that name wins,
 * then a declared variant, else the path a new file would take. Pure — it touches no disk.
 * The slug is sanitised first, so `x.md` answers as `x`, as the listing names it (#159).
 * `variants` lets a caller that already built the index (#118) share it.
 */
export function address(
  root: string,
  type: EntityType,
  slug: string,
  opts: { variants?: Map<string, VariantSource> } = {},
): Address {
  if (!isValidEntityType(type)) {
    throw new WorkspaceError('INVALID_NAME', `Invalid entity type: ${type}`)
  }

  const clean = sanitizeSlug(slug)
  if (!clean) throw new WorkspaceError('INVALID_NAME', `Invalid name: \`${slug}\``)

  const own = findBySlug(path.join(root, ENTITY_TYPES[type]), clean)
  if (own) return { kind: 'file', filePath: own, storageSlug: clean }

  const hit = (opts.variants ?? variantIndex(root, type)).get(clean)
  if (hit) return { kind: 'variant', filePath: hit.filePath, storageSlug: hit.fileSlug, variantOf: hit.fileSlug }

  return { kind: 'new', filePath: resolveEntityPath(root, type, clean), storageSlug: clean }
}

/** `address` for an operation on something that must already be there: refuses NOT_FOUND for `new`. */
export function addressExisting(
  root: string,
  type: EntityType,
  slug: string,
  opts: { variants?: Map<string, VariantSource> } = {},
): Exclude<Address, { kind: 'new' }> {
  const found = address(root, type, slug, opts)
  if (found.kind === 'new') throw new WorkspaceError('NOT_FOUND', `Entity not found: ${type}/${slug}`)
  return found
}
