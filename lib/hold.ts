import { listSections } from './graph'
import { badRequest, conflict, isRefusal, notFound } from './refusal'
import { parseModelOverride } from './pricing'
import type { SectionWarning } from './sectionWarning'
import type { AgentOutput, HoldCandidate, HoldRecord, Refusal, RunMeta } from './types'

const CANDIDATE_HEADING = /^candidate\s+\d+$/i

// The decider writes one `## Candidate N` section per option (#93).
export function sliceCandidates(input: string): HoldCandidate[] {
  return listSections(input).filter(s => CANDIDATE_HEADING.test(s.heading.trim()))
}

/**
 * The record for a hold the wavefront just reached. `fromNode` is the producer on its
 * `in` edge: a wired input with no candidates is warned against that producer.
 */
export function openHold(
  nodeId: string,
  input: string,
  { prompt, fromNode }: { prompt?: string; fromNode?: string } = {},
): { record: HoldRecord; warning?: SectionWarning } {
  const record: HoldRecord = {
    nodeId,
    ...(prompt ? { prompt } : {}),
    input,
    candidates: sliceCandidates(input),
    reachedAt: new Date().toISOString(),
    revision: 1,
  }
  const warning = record.candidates.length === 0 && fromNode !== undefined
    ? { fromNode, section: 'Candidate 1', toNode: nodeId, toSocket: 'candidates' }
    : undefined
  return warning ? { record, warning } : { record }
}

/** A resume body, read: which hold (open by default), the direction, and a candidate heading or the human's own idea. */
export interface AnswerRequest {
  holdId?: string
  direction: string
  chosen?: string
  custom?: string
  modelOverride?: string | null
  /** The candidate set the pick was made from (#134). */
  revision?: number
  /** Leave the source hold open and continue in a new run (#76). */
  fork?: boolean
}

/** A resume body's shape, before it meets a run; a null field is an absent one. */
export function readAnswerRequest({ holdId, direction, chosen, custom, modelOverride, revision, fork }: Record<string, unknown>): AnswerRequest | Refusal {
  const dir = typeof direction === 'string' ? direction : ''
  const hasPick = (chosen != null && typeof chosen === 'string' && chosen.trim() !== '') ||
                  (custom != null && typeof custom === 'string' && custom.trim() !== '')
  if (!dir.trim() && !hasPick) return badRequest('direction or candidate selection is required')
  if (holdId != null && typeof holdId !== 'string') return badRequest('holdId must be a node id')
  if (chosen != null && typeof chosen !== 'string') return badRequest('chosen must be a candidate heading')
  if (custom != null && typeof custom !== 'string') return badRequest('custom must be non-empty text')
  if (fork != null && typeof fork !== 'boolean') return badRequest('fork must be a boolean')
  if (fork && (holdId == null || !hasPick)) return badRequest('fork requires holdId and a candidate selection')
  const parsedOverride = parseModelOverride(modelOverride)
  if (!parsedOverride.valid) return badRequest(parsedOverride.error)
  const rev = readRevision(revision)
  if (isRefusal(rev)) return rev
  return {
    direction: dir,
    holdId: holdId ?? undefined,
    chosen: chosen ?? undefined,
    custom: custom ?? undefined,
    ...(parsedOverride.value !== undefined ? { modelOverride: parsedOverride.value } : {}),
    ...(rev !== undefined ? { revision: rev } : {}),
    ...(fork ? { fork: true } : {}),
  }
}

/** A request's candidate revision; a null field is an absent one. */
export function readRevision(revision: unknown): number | undefined | Refusal {
  if (revision == null) return undefined
  return typeof revision === 'number' && Number.isInteger(revision) && revision > 0
    ? revision
    : badRequest('revision must be a whole number')
}

/** A request's reroll feedback: omitted keeps the saved value, `''` clears it (#134). */
export function readFeedback(feedback: unknown): string | undefined | Refusal {
  if (feedback == null) return undefined
  return typeof feedback === 'string' ? feedback.trim() : badRequest('feedback must be text')
}

/** The hold a resume answers: the named one, else the open one, else a finished run's only hold. */
export function selectHold(meta: RunMeta, holdId?: string): HoldRecord | Refusal {
  const holds = meta.holds ?? []
  if (holdId !== undefined) {
    return holds.findLast(h => h.nodeId === holdId) ?? notFound('holdId names no hold of this run')
  }
  const open = meta.status === 'waiting' ? holds.findLast(h => !h.resolvedAt) : undefined
  if (open) return open
  const holdIds = new Set(holds.map(h => h.nodeId))
  if (holdIds.size > 1) return badRequest('The run has several holds; name one with holdId')
  return holds.at(-1) ?? conflict(`Run is ${meta.status}, not waiting`)
}

/** The open hold of a waiting run that a reroll or feedback edit acts on (#134). */
export function selectOpenHold(meta: RunMeta, holdId: string): HoldRecord | Refusal {
  const hold = selectHold(meta, holdId)
  if ('error' in hold) return hold
  if (meta.status !== 'waiting') return conflict(`Run is ${meta.status}, not waiting`)
  if (hold.resolvedAt) return conflict(`Hold ${holdId} is already answered`)
  return hold
}

/** A hold record's candidate revision; records from before #134 are their first set. */
export const revisionOf = (hold: HoldRecord) => hold.revision ?? 1

/** Whether a pick was made from the hold's current candidates. Without a revision, a candidate
 *  pick is refused once the hold was rerolled: an old Candidate 2 would mean a new one (#134). */
export function checkRevision(hold: HoldRecord, revision: number | undefined, pick: HoldPick | undefined): Refusal | undefined {
  const current = revisionOf(hold)
  if (revision !== undefined) {
    return revision === current ? undefined : conflict(`Candidates of hold ${hold.nodeId} are at revision ${current}, not ${revision}`)
  }
  return pick && 'candidate' in pick && hold.rerolledAt
    ? conflict(`Candidates of hold ${hold.nodeId} were rerolled; resend the pick with revision ${current}`)
    : undefined
}

/** What the human picked at a hold: one of its candidates, or their own idea (#96). */
export type HoldPick = { candidate: HoldCandidate } | { custom: string }

const normalize = (heading: string) => heading.trim().replace(/\s+/g, ' ').toLowerCase()

/** The hold's candidate a request names, forgiving case and spacing in its heading. */
export function findCandidate(hold: HoldRecord, heading: string): HoldCandidate | undefined {
  return hold.candidates.find(c => normalize(c.heading) === normalize(heading))
}

/** A request's pick; neither field given is no pick (#96). */
export function readPick(hold: HoldRecord, chosen?: string, custom?: string): HoldPick | undefined | Refusal {
  if (chosen !== undefined && custom !== undefined) return badRequest('send chosen or custom, not both')
  if (custom !== undefined) return custom.trim() ? { custom: custom.trim() } : badRequest('custom must be non-empty text')
  if (chosen === undefined) return undefined
  const candidate = findCandidate(hold, chosen)
  return candidate ? { candidate } : badRequest(`chosen names no candidate of hold ${hold.nodeId}`)
}

/** One hold's new record, and the run's holds with it in place of the old one. */
export interface HoldUpdate {
  record: HoldRecord
  holds: HoldRecord[]
}

export interface HoldAnswer extends HoldUpdate {
  /** The answer as a replayable output. */
  output: AgentOutput
  /** Re-answering an answered hold forks rather than rewriting the run (#99). */
  mode: 'resume' | 'fork'
}

// Records are copied into and out of meta.json, so a hold is known by where and when it was reached.
const sameHold = (a: HoldRecord, b: HoldRecord) => a.nodeId === b.nodeId && a.reachedAt === b.reachedAt
const replaceHold = (holds: HoldRecord[], hold: HoldRecord, record: HoldRecord) =>
  holds.map(h => (sameHold(h, hold) ? record : h))

/** `hold` as it stood before it was answered: a reroll fork reopens it (#147). */
export function reopenHold(hold: HoldRecord): HoldRecord {
  const open: HoldRecord = { ...hold }
  delete open.chosen; delete open.custom; delete open.direction; delete open.resolvedAt
  return open
}

/** Answers `hold`, one of `holds` (#94, #96). */
export function answerHold(holds: HoldRecord[], hold: HoldRecord, direction: string, pick?: HoldPick): HoldAnswer {
  const at = new Date().toISOString()
  // A re-answered hold drops the earlier answer before taking the new one.
  const open = reopenHold(hold)
  const chosen = pick && 'candidate' in pick ? { chosen: pick.candidate.heading } : {}
  const recorded = pick && 'custom' in pick ? { custom: pick.custom } : chosen
  const lead = !pick ? undefined
    : 'candidate' in pick ? `PICK: ${pick.candidate.heading}\n${pick.candidate.body}`
    : `PICK: custom\n${pick.custom}`
  const text = lead ? (direction && direction.trim() ? `${lead}\n\n${direction}` : lead) : direction
  const record: HoldRecord = { ...open, ...recorded, direction, resolvedAt: at }
  return {
    output: {
      nodeId: hold.nodeId, agentName: 'hold', systemPrompt: '', input: hold.input, output: text,
      tokensIn: 0, tokensOut: 0, costUsd: 0, latencyMs: 0, model: '', timestamp: at, status: 'success',
      ...recorded,
    },
    record,
    holds: replaceHold(holds, hold, record),
    mode: hold.resolvedAt ? 'fork' : 'resume',
  }
}

/** Whether any of `nodeIds` is a hold already answered: rerunning it in place would ask it again (#99). */
export function hasAnsweredHold(holds: HoldRecord[] | undefined, nodeIds: Set<string>): boolean {
  return (holds ?? []).some(h => h.resolvedAt && nodeIds.has(h.nodeId))
}

/** The holds a fork keeps: answered ones outside `dropped`. An open hold carries no answer to replay (#99). */
export function holdsKeptByFork(holds: HoldRecord[] | undefined, dropped: Set<string>): HoldRecord[] {
  return (holds ?? []).filter(h => h.resolvedAt && !dropped.has(h.nodeId))
}

/**
 * A hold reached again while still open refreshes its record rather than adding one:
 * a new candidate set that keeps the hold's feedback (#134) and `like` (#147).
 */
export function mergeHolds(existing: HoldRecord[], reached: HoldRecord[]): HoldRecord[] {
  const merged = [...existing]
  for (const hold of reached) {
    const i = merged.findLastIndex(h => h.nodeId === hold.nodeId && !h.resolvedAt)
    if (i === -1) { merged.push(hold); continue }
    const { feedback, rerolledAt, like } = merged[i]
    merged[i] = { ...hold, ...(feedback ? { feedback } : {}), ...(rerolledAt ? { rerolledAt } : {}), ...(like ? { like } : {}), revision: revisionOf(merged[i]) + 1 }
  }
  return merged
}

/** `hold` with its reroll feedback set to `feedback`; `''` clears it (#134). */
export function withFeedback(holds: HoldRecord[], hold: HoldRecord, feedback: string): HoldUpdate {
  const record: HoldRecord = { ...hold, feedback }
  if (!feedback) delete record.feedback
  return { record, holds: replaceHold(holds, hold, record) }
}

/** `hold` with the candidates a reroll's `input` carries in place of its own (#134). */
export function rerollHold(holds: HoldRecord[], hold: HoldRecord, input: string): HoldUpdate {
  const record: HoldRecord = {
    ...hold, input, candidates: sliceCandidates(input),
    revision: revisionOf(hold) + 1, rerolledAt: new Date().toISOString(),
  }
  return { record, holds: replaceHold(holds, hold, record) }
}
