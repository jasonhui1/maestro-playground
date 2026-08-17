import matter from 'gray-matter'
import fs from 'fs'
import path from 'path'
import { EntityType, ENTITY_TYPES, getWorkspacePath, sanitizeSlug } from './workspace'
import { walkMarkdown, findBySlug } from './discover'
import { getVersionsDir } from './versions'
import {
  RefHit, refSitesFor, parseFile, typeDir, inboundRefs, rewriteRefs,
  variantIndex, VariantSource,
} from './entityRefs'
import { parseVersionKey, versionKey, TouchedFile } from '../runVersions'
import { parseRefs } from '../refs'

/**
 * Types whose slug can also appear in prompt prose, as `{slug}` (a context file) or
 * `{slug.field}` (an agent) — see lib/resolver.ts. Nothing else can appear in prose.
 */
const PROSE_REF_KIND: Partial<Record<EntityType, 'file' | 'agent'>> = {
  context: 'file',
  agent: 'agent',
}

/** One referencing file the rename will rewrite, and the typed fields it will touch. */
export type RenameEdit = RefHit

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

function logsDir() {
  return path.join(getWorkspacePath(), 'logs')
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
    rewrites: addressable ? [...ownEdit, ...inboundRefs(type, from)] : [],
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
      rewriteRefs(data as Record<string, unknown>, sites.filter(s => s.holder === edit.type), from, plan.to)
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
