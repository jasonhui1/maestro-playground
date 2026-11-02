import path from 'path'
import { findBySlug } from './discover'
import { variantIndex, type VariantSource } from './variantIndex'
import { WorkspaceError } from './errors'
import { ENTITY_TYPES, isValidEntityType, resolveEntityPath, type EntityType } from './workspace'

/**
 * What a slug answers to under a type. `file`: a file of that name. `variant`: a variant
 * declared inside another file. `new`: nothing answers to it, and `filePath` is where a
 * save would put it.
 */
export type AddressKind = 'file' | 'variant' | 'new'

export interface Address {
  type: EntityType
  slug: string
  kind: AddressKind
  /** The file this slug acts on: the declaring file for a variant (ADR-0013). */
  filePath: string
  /** The slug the file is stored and versioned under — the declaring file's, for a variant (ADR-0011). */
  storageSlug: string
  /** Set for `variant`: the slug of the file declaring it. */
  variantOf?: string
}

/**
 * The one place a slug becomes a file (ADR-0012, ADR-0013, #164): a file of that name wins,
 * then a declared variant, else the path a new file would take. `variants` lets a caller
 * that already built the index (#118) share it.
 */
export function address(
  root: string,
  type: EntityType,
  slug: string,
  opts: { folder?: string; variants?: Map<string, VariantSource> } = {},
): Address {
  if (!isValidEntityType(type)) {
    throw new WorkspaceError('INVALID_NAME', `Invalid entity type: ${type}`)
  }

  const own = findBySlug(path.join(root, ENTITY_TYPES[type]), slug)
  if (own) return { type, slug, kind: 'file', filePath: own, storageSlug: slug }

  const hit = (opts.variants ?? variantIndex(root, type)).get(slug)
  if (hit) {
    return { type, slug, kind: 'variant', filePath: hit.filePath, storageSlug: hit.fileSlug, variantOf: hit.fileSlug }
  }

  return { type, slug, kind: 'new', filePath: resolveEntityPath(root, type, slug, opts.folder), storageSlug: slug }
}
