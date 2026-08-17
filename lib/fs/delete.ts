import matter from 'gray-matter'
import fs from 'fs'
import path from 'path'
import { EntityType, resolveEntityPath } from './workspace'
import { findBySlug } from './discover'
import { parseFile, typeDir, inboundRefs, variantIndex, declaredVariants, RefHit } from './entityRefs'

export interface DeletePlan {
  type: EntityType
  slug: string
  /** The file a delete acts on — the declaring file, for a variant, which is edited not removed. */
  filePath: string
  /** Set when `slug` names a variant (ADR-0013): the slug of the file declaring it. */
  variantOf?: string
  /** Every name leaving the namespace: the slug, or every variant a declaring file yields. */
  removed: string[]
  /** Files naming a removed name at a typed site. A delete is refused while any exists (#63). */
  blockers: (RefHit & { name: string })[]
  /**
   * Set when the delete takes a file's last variant: the file stays and drops its
   * `variants:` block, becoming addressable by its own name again (ADR-0014).
   */
  promotes?: string
}

/** The file a delete acts on: the named file, or the file declaring the named variant. */
function resolveTarget(type: EntityType, slug: string, variants: Map<string, { filePath: string; fileSlug: string }>) {
  const own = findBySlug(typeDir(type), slug)
  if (own) return { filePath: own }
  const variant = variants.get(slug)
  if (variant) return { filePath: variant.filePath, variantOf: variant.fileSlug }
  throw new Error(`Entity not found: ${type}/${slug}`)
}

/** ``` `rot` is named by decision (chain) ``` — enough for the user to open what is in the way. */
function describe(blockers: (RefHit & { name: string })[]): string {
  const byName = new Map<string, string[]>()
  for (const b of blockers) {
    byName.set(b.name, [...(byName.get(b.name) ?? []), `${path.basename(b.filePath, '.md')} (${b.type})`])
  }
  return [...byName].map(([name, holders]) => `\`${name}\` is named by ${holders.join(', ')}`).join('; ')
}

/**
 * What a delete would do, without touching disk. A file that declares variants is not
 * addressable by its own name (ADR-0013), so the references that block it are the ones
 * naming its variants — never its own slug.
 */
export function planDelete(type: EntityType, slug: string): DeletePlan {
  const variants = variantIndex(type)
  const { filePath, variantOf } = resolveTarget(type, slug, variants)

  const declared = variantOf ? [] : declaredVariants(filePath)
  const removed = variantOf || !declared.length ? [slug] : declared

  const blockers = removed.flatMap(name => inboundRefs(type, name).map(hit => ({ ...hit, name })))

  const remaining = variantOf ? declaredVariants(filePath).filter(id => id !== slug) : []
  const promotes = variantOf && !remaining.length ? path.basename(filePath, '.md') : undefined

  return { type, slug, filePath, variantOf, removed, blockers, promotes }
}

/**
 * Deletes a file, or the one entry a variant is (ADR-0013). Refused while any chain still
 * names what is going — an unresolvable reference stops the whole workspace loading
 * (ADR-0012), so the delete may not create one (#63).
 */
export function deleteWorkspaceEntity(type: EntityType, slug: string) {
  // resolveEntityPath is kept for the not-found path so a missing file of any type still
  // reports the same message, whether or not the type directory exists.
  if (type !== 'agent' && !fs.existsSync(resolveEntityPath(type, slug))) {
    throw new Error(`Entity not found: ${type}/${slug}`)
  }

  const plan = planDelete(type, slug)

  if (plan.blockers.length) {
    // "In use" joins workspaceErrorResponse's shared vocabulary (app/api/workspace/errors.ts)
    // rather than a route hand-matching this message on its own.
    throw new Error(
      `In use: ${describe(plan.blockers)} — repoint or delete ${plan.blockers.length === 1 ? 'it' : 'them'} first`,
    )
  }

  if (!plan.variantOf) {
    fs.unlinkSync(plan.filePath)
    return { success: true, filePath: plan.filePath, plan }
  }

  // Promotion mints the file's own name into the flat namespace it was never in, so it
  // must be free — a duplicate is a hard load failure (ADR-0012, ADR-0014).
  if (plan.promotes) {
    const clash = variantIndex(type).get(plan.promotes)
    if (clash && clash.filePath !== plan.filePath) {
      throw new Error(
        `an agent variant named \`${plan.promotes}\` already exists, declared by ${path.basename(clash.filePath)}`,
      )
    }
  }

  const { data, content } = parseFile(plan.filePath)
  const entries = Array.isArray(data.variants) ? data.variants : []
  const kept = entries.filter(v => !(v && typeof v === 'object' && (v as { id?: unknown }).id === slug))
  if (kept.length === entries.length) throw new Error(`Entity not found: ${type}/${slug}`)

  if (kept.length) data.variants = kept
  else delete data.variants

  fs.writeFileSync(plan.filePath, matter.stringify(content, data), 'utf-8')
  return { success: true, filePath: plan.filePath, plan }
}
