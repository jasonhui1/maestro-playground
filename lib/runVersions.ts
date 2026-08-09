import { AgentDef, ChainDef, ChainNode, SkillDef, ToolDef } from './types'
import { agentSlugOf, resolveNodeSkills } from './nodeKinds'
import { snapshotVersion } from './fs/versions'

/** One workspace file the run reached, with the bytes a version hashes (ADR-0011). */
export interface TouchedFile {
  type: 'chain' | 'agent' | 'skill' | 'context' | 'tool' | 'defaults'
  /** Empty for the defaults file, which is a single file rather than a type folder. */
  slug: string
  content: string
}

interface ContextFile {
  slug: string
  rawContent?: string
}

export interface VersionedWorkspace {
  agents: AgentDef[]
  skills: SkillDef[]
  chains: ChainDef[]
  tools: ToolDef[]
  context: ContextFile[]
  defaultsRaw?: string
}

/** `type/slug`, or the bare type for the single-file defaults. */
export function versionKey(type: TouchedFile['type'], slug: string): string {
  return slug ? `${type}/${slug}` : type
}

/** Inverse of {@link versionKey}, for reading a `RunMeta.versions` entry back into a lookup. */
export function parseVersionKey(key: string): { type: TouchedFile['type']; slug: string } {
  const slash = key.indexOf('/')
  if (slash === -1) return { type: key as TouchedFile['type'], slug: '' }
  return { type: key.slice(0, slash) as TouchedFile['type'], slug: key.slice(slash + 1) }
}

/**
 * Every file the graph can reach, walked before the run starts — so both arms of a
 * branch count as touched, since no branch has been decided yet (ADR-0011).
 * A file the workspace could not load contributes nothing.
 */
export function collectTouchedFiles(chain: ChainDef, ws: VersionedWorkspace): Map<string, TouchedFile> {
  const touched = new Map<string, TouchedFile>()
  const add = (type: TouchedFile['type'], slug: string, content: string | undefined) => {
    if (content === undefined) return
    touched.set(versionKey(type, slug), { type, slug, content })
  }

  add('defaults', '', ws.defaultsRaw)

  // A skill marked `injected: always` reaches every agent, so any agent node pulls it in.
  const alwaysSkills = ws.skills.filter(s => s.injected === 'always')

  const walked = new Set<string>()
  const walk = (c: ChainDef) => {
    if (walked.has(c.slug)) return
    walked.add(c.slug)
    // An agent run and an inline run build a chain in memory, so there is no file to pin.
    if (c.filePath) add('chain', c.slug, c.rawContent)

    for (const node of c.nodes) walkNode(node)
  }

  const walkNode = (node: ChainNode) => {
    if (node.kind === 'context') {
      const file = ws.context.find(f => f.slug === node.file)
      if (file) add('context', file.slug, file.rawContent)
      return
    }
    if (node.kind === 'subchain') {
      const ref = ws.chains.find(x => x.slug === node.subchain)
      if (ref) walk(ref)
      return
    }
    const slug = agentSlugOf(node)
    if (!slug) return
    const agent = ws.agents.find(a => a.slug === slug)
    if (!agent) return
    add('agent', agent.slug, agent.rawContent)

    // An agent names its skills and tools by name; a version key is a slug.
    for (const name of resolveNodeSkills(node, agent.skills)) {
      const skill = ws.skills.find(s => s.name === name)
      if (skill) add('skill', skill.slug, skill.rawContent)
    }
    for (const skill of alwaysSkills) add('skill', skill.slug, skill.rawContent)
    for (const name of agent.tools ?? []) {
      const tool = ws.tools.find(t => t.name === name)
      if (tool) add('tool', tool.slug, tool.rawContent)
    }
  }

  walk(chain)
  return touched
}

/** Snapshots every touched file and returns the map `meta.json` records (ADR-0011). */
export function pinRunVersions(chain: ChainDef, ws: VersionedWorkspace): Record<string, number> {
  const versions: Record<string, number> = {}
  for (const [key, file] of collectTouchedFiles(chain, ws)) {
    versions[key] = snapshotVersion(file.type, file.slug, file.content)
  }
  return versions
}
