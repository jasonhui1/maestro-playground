import matter from 'gray-matter'
import type { AgentDef, ChainDef, ChainNode, Refusal, RunMeta, SkillDef, ToolDef } from './types'
import { kindOf, fieldValue, resolveNodeSkills } from './nodeKinds'
import { versionKey, type TouchedFile } from './runVersionModel'
import { unprocessable } from './refusal'
import { validateChain } from './chainGraph'
import { chainForResume } from './resolveRunChain'
import { pinnedWorkspace } from './pinnedWorkspace'
import type { LiveWorkspace } from './runFolders'
import type { VersionedRoot } from './versionStore'
import type { RunDefinitions } from './runDefinitions'

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

  const walkAgent = (node: ChainNode, slug: string) => {
    const agent = ws.agents.find(a => a.slug === slug)
    if (!agent) return
    // A variant has no file of its own, so the key is the declaring file (ADR-0013).
    add('agent', agent.variantOf ?? agent.slug, agent.rawContent)

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

  // The files a node names are its descriptor's `ref` fields (ADR-0001). A node's skill
  // fields are not walked on their own: they override or extend the agent's list.
  const walkNode = (node: ChainNode) => {
    for (const field of kindOf(node.kind).fields) {
      const slug = fieldValue(node, field)
      if (!field.ref || typeof slug !== 'string') continue
      if (field.ref === 'context') {
        const file = ws.context.find(f => f.slug === slug)
        if (file) add('context', file.slug, file.rawContent)
      } else if (field.ref === 'chain') {
        const ref = ws.chains.find(x => x.slug === slug)
        if (ref) walk(ref)
      } else if (field.ref === 'agent') {
        walkAgent(node, slug)
      } else if (field.ref === 'tool') {
        // A tool node names its tool by name, like an agent's tool list.
        const tool = ws.tools.find(t => t.name === slug)
        if (tool) add('tool', tool.slug, tool.rawContent)
      }
    }
  }

  walk(chain)
  return touched
}

/** Which files a fork reruns: the live ones, or the source run's pins (ADR-0011). */
export type ContinuationVersions = 'current' | 'pinned'

export type RunFilesFrom =
  /** A new run over `chain`: every file it touches is snapshotted. */
  | { kind: 'start'; chain: ChainDef; entrypoint?: RunMeta['entrypoint'] }
  /** A stretch in the run's own folder: the live files, under the run's own pins (ADR-0011). */
  | { kind: 'inPlace'; run: RunMeta }
  /** A new run forked from `run`: the live files snapshotted, or the source's pins read back. */
  | { kind: 'fork'; run: RunMeta; files: ContinuationVersions }

export interface RunFiles {
  chain: ChainDef
  definitions: RunDefinitions
  versions: Record<string, number>
  /** The entry file's version, stamped on every log; 0 stamps nothing. */
  versionNumber: number
  /** Context files at their pins, for the executor's context overrides. */
  pinnedContext: Record<string, string>
}

export function runFiles(ws: VersionedRoot, live: LiveWorkspace, from: Extract<RunFilesFrom, { kind: 'start' }>): RunFiles
export function runFiles(ws: VersionedRoot, live: LiveWorkspace, from: RunFilesFrom): RunFiles | Refusal
export function runFiles(ws: VersionedRoot, live: LiveWorkspace, from: RunFilesFrom): RunFiles | Refusal {
  if (from.kind === 'start') return snapshot(ws, from.chain, live, from.entrypoint)
  const { run } = from
  if (from.kind === 'inPlace') {
    const chain = graphOver(run, live)
    if ('error' in chain) return chain
    // The run's pins stay as it started (ADR-0011); only the stamped entry file is snapshotted (#169).
    const entry = collectTouchedFiles(chain, live).get(entryKey(chain, live, run.entrypoint))
    const versionNumber = entry ? ws.versions.snapshot(entry.type, entry.slug, entry.content) : 0
    return { chain, definitions: live, versions: run.versions ?? {}, versionNumber, pinnedContext: {} }
  }
  if (from.files === 'current') {
    const chain = graphOver(run, live)
    return 'error' in chain ? chain : snapshot(ws, chain, live, run.entrypoint)
  }
  if (!run.versions) return unprocessable('Run has no pinned versions')
  const pinned = pinnedWorkspace(ws, live, run.versions)
  if ('error' in pinned) return pinned
  const { context: pinnedContext, ...definitions } = pinned
  const chain = graphOver(run, definitions)
  if ('error' in chain) return chain
  const versionNumber = run.versions[entryKey(chain, definitions, run.entrypoint)] ?? run.versionNumber ?? 0
  return { chain, definitions, versions: run.versions, versionNumber, pinnedContext }
}

/**
 * The key of the file a run is versioned by: an agent or tool entry's own file, else its chain.
 * A continued agent or tool run's graph has no chain file, so the entrypoint names it (#169);
 * a variant's file is its declaring one (ADR-0013).
 */
function entryKey(chain: ChainDef, defs: RunDefinitions, entrypoint: RunMeta['entrypoint']): string {
  const { kind, slug } = entrypoint ?? {}
  if (!slug || (kind !== 'agent' && kind !== 'tool')) return versionKey('chain', chain.slug)
  const variantOf = kind === 'agent' ? defs.agents.find(a => a.slug === slug)?.variantOf : undefined
  return versionKey(kind, variantOf ?? slug)
}

function snapshot(ws: VersionedRoot, chain: ChainDef, live: LiveWorkspace, entrypoint: RunMeta['entrypoint']): RunFiles {
  const versions: Record<string, number> = {}
  const pinnedContext: Record<string, string> = {}
  for (const [key, file] of collectTouchedFiles(chain, live)) {
    versions[key] = ws.versions.snapshot(file.type, file.slug, file.content)
    if (file.type === 'context') pinnedContext[file.slug] = matter(file.content).content
  }
  return { chain, definitions: live, versions, versionNumber: versions[entryKey(chain, live, entrypoint)] ?? 0, pinnedContext }
}

function graphOver(meta: RunMeta, defs: RunDefinitions): ChainDef | Refusal {
  const chain = chainForResume(meta, defs.chains)
  if (!chain) return unprocessable('Run has no recorded graph')
  const validation = validateChain(chain, defs)
  if (!validation.valid) return { error: 'Invalid chain', status: 400, errors: validation.errors }
  return chain
}
