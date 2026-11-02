import fs from 'fs'
import path from 'path'
import { address, addressExisting } from './address'
import { WorkspaceError } from './errors'
import { parseSkill } from './parseSkill'
import { parseChain } from './parseChain'
import { parseTemplate } from './parseTemplate'
import { parseTool } from './parseTool'
import { loadAgentDefaults } from './defaults'
import { walkDirectories } from './discover'
import { buildChainFromTemplate } from './forkChain'
import { forbiddenAgentFields, forbiddenAgentFieldMessage, validateEntityFrontmatter } from './validate'
import { createWorkspaceEntity, createWorkspaceFolder, saveAddressed, saveWorkspaceEntity } from './save'
import {
  ENTITY_TYPES, loadAgent, loadWorkspace, resolveEntityPath, resolveFolderPath, sanitizeFolder, sanitizeSlug,
  type EntityType,
} from './workspace'
import { chainToData } from '../serializeChain'

/**
 * What the file routes call (#164). A slug is turned into a file once, by `address`
 * (ADR-0012, ADR-0013); each operation then acts on that file. A refusal is a
 * `WorkspaceError` whose `kind` the route maps to a status (#117).
 */
export { address, addressExisting, type Address } from './address'
export { planRename, renameWorkspaceEntity, type RenamePlan } from './rename'
export { deleteWorkspaceEntity } from './delete'
export { moveWorkspaceEntity, renameWorkspaceFolder, deleteWorkspaceFolder } from './save'
export { isValidEntityType, type EntityType } from './workspace'

const PARSERS: Record<EntityType, (root: string, filePath: string, slug: string) => object> = {
  agent: (root, filePath) => loadAgent(root, filePath),
  skill: (_root, filePath) => parseSkill(filePath),
  chain: (_root, filePath) => parseChain(filePath),
  template: (_root, filePath) => parseTemplate(filePath),
  tool: (_root, filePath) => parseTool(filePath),
  context: (_root, _filePath, slug) => ({ slug, name: slug }),
}

/** One file, parsed, plus its raw text. A variant reads as its declaring file (#118, #123). */
export function readEntity(root: string, type: EntityType, slug: string) {
  const { filePath, storageSlug } = addressExisting(root, type, slug)

  const parsed = PARSERS[type](root, filePath, storageSlug)
  return { ...parsed, raw: fs.readFileSync(filePath, 'utf-8') }
}

/**
 * Saves frontmatter and body. Refused for an agent stating a field it may not (ADR-0010).
 * Missing required fields do not refuse the save — they come back as `warnings` (#122).
 * A variant saves into its declaring file (#118, #123). `expectedRaw` conditions the
 * write and `raw` is the text written (#158).
 */
export function saveEntity(
  root: string,
  req: { type: EntityType; slug: string; data: Record<string, unknown>; content: string; expectedRaw?: string | null },
): { filePath: string; slug: string; raw: string; warnings?: string[] } {
  const { type, slug, data, content, expectedRaw } = req
  if (type === 'agent') {
    const forbidden = forbiddenAgentFields(data)
    if (forbidden.length > 0) throw new WorkspaceError('INVALID_CONTENT', forbiddenAgentFieldMessage(forbidden))
  }

  const defaults = type === 'agent' ? loadAgentDefaults(root) : undefined
  const warnings = validateEntityFrontmatter(type, data, defaults).errors

  const saved = saveAddressed(root, type, address(root, type, slug), data, content, expectedRaw)
  return warnings.length > 0 ? { ...saved, warnings } : saved
}

// "an agent" vs "a skill" — the only vowel-leading type name is "agent".
function alreadyExistsMessage(type: EntityType, slug: string) {
  const article = /^[aeiou]/i.test(type) ? 'an' : 'a'
  return `${article} ${type} named \`${slug}\` already exists`
}

/**
 * Creates a file, from the type's template or, for a chain, from a template file. A new
 * file is placed by slug and folder alone: a name already taken by a file or a variant
 * is refused (ADR-0013, #151).
 */
export function createEntity(
  root: string,
  req: { type: EntityType; name: string; slug?: string; folder?: string; fromTemplate?: string },
) {
  const { type, name, folder, fromTemplate } = req

  if (type === 'chain' && fromTemplate) {
    const { templates, chains } = loadWorkspace(root)
    const tmpl = templates.find(t => t.slug === fromTemplate)
    if (!tmpl) throw new WorkspaceError('NOT_FOUND', 'Template not found')

    const forked = buildChainFromTemplate(tmpl, name, chains)
    if (fs.existsSync(resolveEntityPath(root, 'chain', forked.slug, folder))) {
      throw new WorkspaceError('ALREADY_EXISTS', alreadyExistsMessage('chain', forked.slug))
    }
    const data = chainToData({ ...forked, filePath: '' })
    const saved = saveWorkspaceEntity(root, { type: 'chain', slug: forked.slug, data, content: '', folder })
    return { ...saved, seedPrompt: tmpl.seedPrompt }
  }

  const cleanSlug = sanitizeSlug(req.slug || name.toLowerCase().replace(/\s+/g, '-'))
  if (fs.existsSync(resolveEntityPath(root, type, cleanSlug, folder))) {
    throw new WorkspaceError('ALREADY_EXISTS', alreadyExistsMessage(type, cleanSlug))
  }
  return createWorkspaceEntity(root, { type, name, slug: cleanSlug, folder })
}

/** Makes an empty folder `name` under `parent` (both relative to the type directory). */
export function createFolder(root: string, type: EntityType, name: string, parent?: string) {
  const cleanName = sanitizeFolder(name)
  if (!cleanName) throw new WorkspaceError('INVALID_NAME', 'Invalid folder name')

  const target = parent ? `${parent}/${cleanName}` : cleanName
  if (fs.existsSync(resolveFolderPath(root, type, target))) {
    throw new WorkspaceError('ALREADY_EXISTS', `a folder named \`${name}\` already exists here`)
  }
  return createWorkspaceFolder(root, type, target)
}

/** Every sub-folder under a type directory, even an empty one — discovery never sees a bare directory. */
export function listFolders(root: string, type: EntityType): string[] {
  const dir = path.join(root, ENTITY_TYPES[type])
  return walkDirectories(dir).map(abs => path.relative(dir, abs).replace(/\\/g, '/'))
}
