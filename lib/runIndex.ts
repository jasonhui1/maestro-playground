import { agentSlugOf } from './nodeKinds'
import { versionKey, type TouchedFile } from './runVersionModel'
import type { RunFolders } from './runFolders'
import type { ChainDef, RunMeta } from './types'

export type RunSubjectKind = NonNullable<RunMeta['entrypoint']>['kind']

/** What a run ran, and where the run opens. */
export interface RunSubject {
  kind: RunSubjectKind
  /** Absent on runs recorded before their entry point was (#131; chats #168). */
  slug?: string
  /** The display name the subject had when the run started; a chat's is its agent's. */
  name: string
  /** Where this run opens. */
  href: string
}

/** A subject to list runs of; `name` finds the runs recorded before slugs were. */
export interface SubjectRef {
  kind: RunSubjectKind
  slug: string
  name?: string
}

/** An agent that took part in a run, as a call site, an agent run or a chat. */
export interface AgentRef {
  slug: string
  name?: string
}

export interface RunFilter {
  of?: SubjectRef
  involving?: AgentRef
  /** A `type/slug` version key the run pins (ADR-0011). */
  pinning?: string
  /** The title the run started under, exactly. */
  title?: string
  status?: RunMeta['status']
  /** Case-insensitive, in the seed prompt or run id. */
  keyword?: string
  branchedFromRunId?: string
  varianceGroupId?: string
}

const CHAT_PREFIX = 'Chat with '

/** The title a chat with an agent is recorded under. */
export function chatTitle(agentName: string): string {
  return `${CHAT_PREFIX}${agentName}`
}

/** Runs recorded before `entrypoint` are classified by the title they started under. */
function kindOf(meta: RunMeta): RunSubjectKind {
  if (meta.entrypoint) return meta.entrypoint.kind
  const title = meta.chainName
  if (meta.chainSlug === 'inline' || title === 'Inline chain' || title.toLowerCase().startsWith('inline ')) return 'inline'
  if (title.startsWith(CHAT_PREFIX)) return 'chat'
  return 'chain'
}

export function runSubject(meta: RunMeta): RunSubject {
  const kind = kindOf(meta)
  const slug = meta.chainSlug ?? meta.entrypoint?.slug
  return {
    kind,
    ...(slug && slug !== 'inline' ? { slug } : {}),
    name: kind === 'chat' && meta.chainName.startsWith(CHAT_PREFIX) ? meta.chainName.slice(CHAT_PREFIX.length) : meta.chainName,
    href: kind === 'chat' ? `/chat?runId=${meta.runId}` : `/history/${meta.runId}`,
  }
}

export function chainRef(chain: Pick<ChainDef, 'slug' | 'name'>): SubjectRef {
  return { kind: 'chain', slug: chain.slug, name: chain.name }
}

/** An inline run carrying a chain's slug is that chain run from its editor. */
const kindsMatching = (kind: RunSubjectKind): RunSubjectKind[] => kind === 'chain' ? ['chain', 'inline'] : [kind]

/** A chat pins nothing. */
const PIN_TYPE: Record<RunSubjectKind, TouchedFile['type'] | undefined> = {
  chain: 'chain', inline: 'chain', agent: 'agent', tool: 'tool', chat: undefined,
}

/**
 * A rename repoints a run's pins but not its recorded slug (#168): the run is the ref's
 * when it pins the ref and no longer pins its own slug.
 */
function renamedTo(meta: RunMeta, subject: RunSubject, ref: SubjectRef): boolean {
  const type = PIN_TYPE[ref.kind]
  const pins = meta.versions ?? {}
  return type !== undefined && versionKey(type, ref.slug) in pins
    && !(subject.slug && versionKey(type, subject.slug) in pins)
}

export function isRunOf(meta: RunMeta, ref: SubjectRef): boolean {
  const subject = runSubject(meta)
  if (!kindsMatching(ref.kind).includes(subject.kind)) return false
  if (subject.slug === ref.slug || renamedTo(meta, subject, ref)) return true
  if (subject.slug) return false
  const title = ref.name === undefined ? undefined : ref.kind === 'chat' ? chatTitle(ref.name) : ref.name
  return meta.chainName === title || meta.chainName === ref.slug
}

/**
 * Pins name every agent a run touched (ADR-0011), so they survive a rename. An output with
 * no node in the recorded graph (a chat turn, a subchain's inner node, a run from before
 * graph capture) only has its display name.
 */
function isRunInvolving(meta: RunMeta, agent: AgentRef): boolean {
  const subject = runSubject(meta)
  if ((subject.kind === 'agent' || subject.kind === 'chat') && subject.slug === agent.slug) return true
  if (meta.versions && versionKey('agent', agent.slug) in meta.versions) return true
  const nodes = new Map((meta.graph?.nodes ?? []).map(n => [n.id, n]))
  return meta.agentOutputs.some(o => {
    const node = o.nodeId ? nodes.get(o.nodeId) : undefined
    if (node) return agentSlugOf(node) === agent.slug
    return agent.name !== undefined && o.agentName === agent.name
  })
}

const startedAt = (meta: RunMeta) => new Date(meta.startedAt).getTime() || 0

/** Newest first; a tie in start time goes to the later run id. */
function newestFirst(a: RunMeta, b: RunMeta): number {
  return startedAt(b) - startedAt(a) || b.runId.localeCompare(a.runId)
}

/** Every run matching all of the filter's fields, newest first. */
export function filterRuns(runs: RunMeta[], filter: RunFilter = {}): RunMeta[] {
  const { of, involving, pinning, title, status, keyword, branchedFromRunId, varianceGroupId } = filter
  const kw = keyword?.toLowerCase()
  return runs.filter(r =>
    (!of || isRunOf(r, of))
    && (!involving || isRunInvolving(r, involving))
    && (!pinning || (r.versions !== undefined && pinning in r.versions))
    && (title === undefined || r.chainName === title)
    && (!status || r.status === status)
    && (!branchedFromRunId || r.branchedFromRunId === branchedFromRunId)
    && (!varianceGroupId || r.variance?.groupId === varianceGroupId)
    && (!kw || r.seedPrompt.toLowerCase().includes(kw) || r.runId.toLowerCase().includes(kw)),
  ).sort(newestFirst)
}

/** Slugs decide when both runs have one; otherwise the titles, or a title naming the other's slug. */
function sameSubject(a: RunMeta, b: RunMeta): boolean {
  const sa = runSubject(a)
  const sb = runSubject(b)
  if (sa.slug && sb.slug) return sa.kind === sb.kind && sa.slug === sb.slug
  return a.chainName === b.chainName || sa.slug === b.chainName || sb.slug === a.chainName
}

/** The latest earlier run of the same subject; an inline run has none, and is none (#131). */
export function previousRun(runs: RunMeta[], current: RunMeta): RunMeta | undefined {
  const inline = (meta: RunMeta) => kindOf(meta) === 'inline'
  if (inline(current)) return undefined
  return runs
    .filter(r => r.runId !== current.runId && !inline(r) && newestFirst(current, r) < 0 && sameSubject(current, r))
    .sort(newestFirst)[0]
}

/** A chain by display name, falling back to slug. */
export function chainNamed(chains: ChainDef[], name: string): ChainDef | undefined {
  return chains.find(c => c.name === name) ?? chains.find(c => c.slug === name)
}

/** The live chain a run ran, by slug, else by the title it started under; none for an agent, tool or chat. */
export function runChain(meta: RunMeta, chains: ChainDef[]): ChainDef | undefined {
  const subject = runSubject(meta)
  if (subject.kind !== 'chain' && subject.kind !== 'inline') return undefined
  return (subject.slug ? chains.find(c => c.slug === subject.slug) : undefined) ?? chainNamed(chains, meta.chainName)
}

/** The runs under `logs/`, asked what they ran. */
export interface RunIndex {
  list(filter?: RunFilter): RunMeta[]
  previous(run: RunMeta): RunMeta | undefined
}

export function runIndex(runs: RunFolders): RunIndex {
  return {
    list: filter => filterRuns(runs.list(), filter),
    previous: run => previousRun(runs.list(), run),
  }
}
