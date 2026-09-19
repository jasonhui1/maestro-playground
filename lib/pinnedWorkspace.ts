import path from 'path'
import matter from 'gray-matter'
import { getVersionContent } from './fs/versions'
import { getWorkspacePath } from './fs/workspacePath'
import { parseAgentFile } from './fs/parseAgent'
import { parseSkill } from './fs/parseSkill'
import { parseTool } from './fs/parseTool'
import { parseChain } from './fs/parseChain'
import { parseVersionKey } from './runVersions'
import type { AgentDef, ChainDef, Refusal, SkillDef, ToolDef } from './types'

export interface PinnedWorkspace {
  agents: AgentDef[]
  skills: SkillDef[]
  chains: ChainDef[]
  tools: ToolDef[]
  /** Pinned context files by slug, as the executor's context overrides take them. */
  context: Record<string, string>
}

type Defs = Omit<PinnedWorkspace, 'context'>

/** Per pinnable type: where its files live, which list it fills, and how a pinned file replaces its live entries. */
const PINNABLE: Record<string, {
  dir: string
  list: keyof Defs
  /** Whether a live entry came from this file; a variant comes from its declaring file (ADR-0013). */
  ofFile: (def: { slug: string; variantOf?: string }, slug: string) => boolean
  parse: (filePath: string, raw: string, defaults: Record<string, unknown>) => Defs[keyof Defs]
}> = {
  agent: { dir: 'agents', list: 'agents', ofFile: (d, slug) => (d.variantOf ?? d.slug) === slug, parse: parseAgentFile },
  skill: { dir: 'skills', list: 'skills', ofFile: (d, slug) => d.slug === slug, parse: (p, raw) => [parseSkill(p, raw)] },
  tool: { dir: 'tools', list: 'tools', ofFile: (d, slug) => d.slug === slug, parse: (p, raw) => [parseTool(p, raw)] },
  chain: { dir: 'chains', list: 'chains', ofFile: (d, slug) => d.slug === slug, parse: (p, raw) => [parseChain(p, raw)] },
}

/**
 * The live workspace with every pinned file read back at its recorded version (ADR-0011):
 * what a fork asked for with `versions: 'pinned'` runs against. A pin whose version is gone refuses.
 */
export function pinnedWorkspace(
  live: Defs & { defaults: Record<string, unknown> },
  versions: Record<string, number>,
): PinnedWorkspace | Refusal {
  const pins: { type: string; slug: string; raw: string }[] = []
  for (const [key, version] of Object.entries(versions)) {
    const { type, slug } = parseVersionKey(key)
    const raw = getVersionContent(type, slug, version)
    if (raw === null) return { error: `Pinned ${key} v${version} is missing`, status: 422 }
    pins.push({ type, slug, raw })
  }

  const defaultsRaw = pins.find(p => p.type === 'defaults')?.raw
  const defaults = defaultsRaw === undefined ? live.defaults : matter(defaultsRaw).data as Record<string, unknown>
  const ws: PinnedWorkspace = { agents: live.agents, skills: live.skills, chains: live.chains, tools: live.tools, context: {} }

  for (const { type, slug, raw } of pins) {
    if (type === 'context') ws.context[slug] = matter(raw).content
    const pinnable = PINNABLE[type]
    if (!pinnable) continue
    const entries = live[pinnable.list] as { slug: string; variantOf?: string; filePath: string }[]
    const filePath = entries.find(d => pinnable.ofFile(d, slug))?.filePath
      ?? path.join(getWorkspacePath(), pinnable.dir, `${slug}.md`)
    const kept = (ws[pinnable.list] as typeof entries).filter(d => !pinnable.ofFile(d, slug))
    ;(ws[pinnable.list] as unknown[]) = [...kept, ...pinnable.parse(filePath, raw, defaults)]
  }
  return ws
}
