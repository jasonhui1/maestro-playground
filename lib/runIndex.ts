import { agentSlugOf } from './nodeKinds'
import type { RunFolders } from './runFolders'
import type { ChainDef, RunMeta } from './types'

export type RunSubjectKind = 'chain' | 'agent' | 'tool' | 'chat' | 'inline'

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

export function isInlineRun(meta: RunMeta): boolean {
  return kindOf(meta) === 'inline'
}

/** An inline run carrying a chain's slug is that chain run from its editor. */
const kindsOf = (kind: RunSubjectKind): RunSubjectKind[] => kind === 'chain' ? ['chain', 'inline'] : [kind]

export function isRunOf(meta: RunMeta, ref: SubjectRef): boolean {
  const subject = runSubject(meta)
  if (!kindsOf(ref.kind).includes(subject.kind)) return false
  if (subject.slug) return subject.slug === ref.slug
  const title = ref.name === undefined ? undefined : ref.kind === 'chat' ? chatTitle(ref.name) : ref.name
  return meta.chainName === title || meta.chainName === ref.slug
}

/**
 * An output is the agent's when its node names the agent; one with no node in the
 * recorded graph (a chat turn, a run from before graph capture) only has its name.
 */
export function isRunInvolving(meta: RunMeta, agent: AgentRef): boolean {
  const subject = runSubject(meta)
  if ((subject.kind === 'agent' || subject.kind === 'chat') && subject.slug === agent.slug) return true
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
  const { of, involving, title, status, keyword, branchedFromRunId, varianceGroupId } = filter
  const kw = keyword?.toLowerCase()
  return runs.filter(r =>
    (!of || isRunOf(r, of))
    && (!involving || isRunInvolving(r, involving))
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
  if (isInlineRun(current)) return undefined
  return runs
    .filter(r => r.runId !== current.runId && !isInlineRun(r) && newestFirst(current, r) < 0 && sameSubject(current, r))
    .sort(newestFirst)[0]
}

/** The live chain a run ran, by slug, else by the title it started under; none for an agent, tool or chat. */
export function runChain(meta: RunMeta, chains: ChainDef[]): ChainDef | undefined {
  const subject = runSubject(meta)
  if (subject.kind !== 'chain' && subject.kind !== 'inline') return undefined
  return (subject.slug ? chains.find(c => c.slug === subject.slug) : undefined)
    ?? chains.find(c => c.name === meta.chainName)
    ?? chains.find(c => c.slug === meta.chainName)
}

/** The runs under `logs/`, asked what they ran. */
export interface RunIndex {
  /** Throws when there is no such run. */
  subject(runId: string): RunSubject
  list(filter?: RunFilter): RunMeta[]
  previous(run: RunMeta): RunMeta | undefined
  /** The ids of the runs whose pins include `key` (ADR-0011). */
  pinning(key: string): string[]
}

export function runIndex(runs: RunFolders): RunIndex {
  return {
    subject: runId => runSubject(runs.read(runId)),
    list: filter => filterRuns(runs.list(), filter),
    previous: run => previousRun(runs.list(), run),
    pinning: key => runs.list().filter(r => r.versions && key in r.versions).map(r => r.runId),
  }
}
